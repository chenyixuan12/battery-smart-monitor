import {
  AmbientLight,
  Clock,
  Color,
  DirectionalLight,
  Group,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import type { AlarmSeverity, DeviceStatus, DeviceStatusPatch, ScenePerformanceSample } from '../../types'
import { AgvController } from './AgvController'
import { FactoryBuilder } from './FactoryBuilder'
import { InstanceDeviceLayer } from './InstanceDeviceLayer'
import { disposeObjectTree } from './resourceDisposer'
import type { DevicePickedEvent, FactoryDevice } from './types'

interface CameraTween {
  startPosition: Vector3
  endPosition: Vector3
  startTarget: Vector3
  endTarget: Vector3
  elapsedSeconds: number
  durationSeconds: number
}

/** Owns the Three.js scene and exposes the narrow API consumed by Vue. */
export class FactorySceneManager {
  private static readonly alarmFocusCooldownMs = 8_000

  private scene: Scene | null = null
  private camera: PerspectiveCamera | null = null
  private renderer: WebGLRenderer | null = null
  private controls: OrbitControls | null = null
  private instanceLayer: InstanceDeviceLayer | null = null
  private agvController: AgvController | null = null
  private devices: FactoryDevice[] = []
  private lineGroups = new Map<string, Group>()
  // 计算相邻两帧之间经过的秒数
  private readonly clock = new Clock()
  /** 当前动画帧 ID，用于避免重复启动，并在销毁时停止循环。 */
  private animationFrameId: number | null = null
  /** Distinguishes a deliberate click from an OrbitControls drag gesture. */
  private pointerDownPosition: { x: number; y: number } | null = null
  private cameraTween: CameraTween | null = null
  private readonly activeCriticalAlarmIds = new Set<string>()
  private lastAlarmFocusTimeMs = Number.NEGATIVE_INFINITY
  private pendingCriticalAlarmId: string | null = null
  private performanceWindowStartedAt = performance.now()
  private performanceFrameCount = 0
  private performanceFrameTimeTotalMs = 0
  private performanceMaxFrameMs = 0
  onDevicePicked: ((event: DevicePickedEvent) => void) | null = null
  onAlarmFocused: ((event: DevicePickedEvent) => void) | null = null
  onPerformanceSample: ((sample: ScenePerformanceSample) => void) | null = null

  /** Initialize scene, camera, renderer, controls and static workshop geometry. */
  init(container: HTMLElement): void {
    const width = Math.max(container.clientWidth, 1)
    const height = Math.max(container.clientHeight, 1)
    this.scene = new Scene()
    this.scene.background = new Color('#0a1318')
    this.scene.add(new AmbientLight(0xffffff, 1.7))
    const keyLight = new DirectionalLight(0xd8ffff, 2.2)
    keyLight.position.set(8, 14, 9)
    this.scene.add(keyLight)

    this.camera = new PerspectiveCamera(44, width / height, 0.1, 120)
    this.camera.position.set(15, 16, 20)
    this.camera.lookAt(0, 0, 0)
    this.renderer = new WebGLRenderer({ antialias: true, alpha: false })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(width, height)
    this.renderer.outputColorSpace = SRGBColorSpace
    this.renderer.domElement.className = 'factory-webgl-canvas'
    this.renderer.domElement.setAttribute('aria-label', 'PACK 工厂三维视图')
    container.appendChild(this.renderer.domElement)

    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.target.set(0, 0, 0)
    const build = new FactoryBuilder().build(this.scene)
    this.devices = build.devices
    this.lineGroups = build.lineGroups
    this.instanceLayer = new InstanceDeviceLayer(this.scene, this.camera, this.devices)
    this.agvController = new AgvController(build.root)

    // Treat configured critical devices as initial alarm events after every scene dependency exists.
    for (const device of this.devices) {
      if (device.status === 'alarm' && device.alarmSeverity === 'critical') {
        this.activeCriticalAlarmIds.add(device.id)
        this.requestCriticalAlarmFocus(device.id)
      }
    }

    this.renderer.render(this.scene, this.camera)
    this.renderer.domElement.addEventListener('pointerdown', this.handlePointerDown, { capture: true })
    this.renderer.domElement.addEventListener('pointerup', this.handlePointerUp)
    this.renderer.domElement.addEventListener('pointercancel', this.handlePointerCancel)
    this.renderer.domElement.addEventListener('wheel', this.handleManualCameraInput, { passive: true, capture: true })
    this.performanceWindowStartedAt = performance.now()
    this.performanceFrameCount = 0
    this.performanceFrameTimeTotalMs = 0
    this.performanceMaxFrameMs = 0

    // Start exactly one browser-synchronised frame loop for this manager instance.
    if (this.animationFrameId !== null) {
      window.cancelAnimationFrame(this.animationFrameId)
    }
    this.clock.start()
    this.animationFrameId = window.requestAnimationFrame(this.renderLoop)
  }

  /** Update a device and auto-focus only when it newly enters a critical alarm episode. */
  updateDeviceStatus(
    deviceId: string,
    status: DeviceStatus,
    alarmSeverity: AlarmSeverity = 'warning',
  ): void {
    this.updateDeviceStatuses([{ deviceId, status, alarmSeverity }])
  }

  /** Submit one frame's status changes with one InstancedMesh color-buffer upload. */
  updateDeviceStatuses(patches: readonly DeviceStatusPatch[]): void {
    this.instanceLayer?.updateDeviceStatuses(patches)
    for (const patch of patches) this.reconcileCriticalAlarm(patch)
  }

  /** Resize the camera and renderer after the Vue canvas container changes dimensions. */
  resize(): void {
    const canvas = this.renderer?.domElement
    if (!canvas || !this.camera || !this.renderer) return
    const host = canvas.parentElement
    if (!host) return
    const width = Math.max(host.clientWidth, 1)
    const height = Math.max(host.clientHeight, 1)
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(width, height)
    if (this.scene) this.renderer.render(this.scene, this.camera)
  }

  /** Ray-picking entry point called by the renderer's pointer handler. */
  pick(event: PointerEvent): FactoryDevice | null {
    const canvas = this.renderer?.domElement
    if (!canvas || !this.instanceLayer) return null
    return this.instanceLayer.pick(event.clientX, event.clientY, canvas.getBoundingClientRect())
  }

  /** Smoothly move the camera and controls target toward a known device. */
  focusOnDevice(deviceId: string): void {
    const device = this.instanceLayer?.getDevice(deviceId)
    if (!device || !this.camera || !this.controls) return
    const endTarget = device.position.clone().add(new Vector3(0, 0.6, 0))
    this.instanceLayer?.setSelected(deviceId)
    this.cameraTween = {
      startPosition: this.camera.position.clone(),
      endPosition: endTarget.clone().add(new Vector3(4.8, 4.2, 5.4)),
      startTarget: this.controls.target.clone(),
      endTarget,
      elapsedSeconds: 0,
      durationSeconds: 1.1,
    }
    this.controls.enabled = false
  }

  /** Show or clear the reusable device selection marker without moving the camera. */
  setSelectedDevice(deviceId: string | null): void {
    this.instanceLayer?.setSelected(deviceId)
  }

  /** Emphasize one production line and restore all others to their neutral material. */
  highlightLine(lineId: string | null): void {
    for (const [id, group] of this.lineGroups) {
      const selected = id === lineId
      group.traverse((object) => {
        if (!(object instanceof Mesh)) return
        const materials = Array.isArray(object.material) ? object.material : [object.material]
        for (const material of materials) {
          if (!(material instanceof MeshStandardMaterial)) continue
          material.emissive.setHex(selected ? 0x178b7a : 0x000000)
          material.emissiveIntensity = selected ? 0.72 : 0
          material.needsUpdate = true
        }
      })
    }
  }

  /** Update AGV simulation state; the future frame loop should provide delta seconds. */
  updateAgvs(deltaSeconds: number): void {
    this.agvController?.update(deltaSeconds)
  }

  /** Stop runtime work and release all DOM, CPU and WebGL resources owned by the scene. */
  destroy(): void {
    // Stop scheduling frames first so an unmounted Vue component cannot keep rendering.
    if (this.animationFrameId !== null) {
      window.cancelAnimationFrame(this.animationFrameId)
      this.animationFrameId = null
    }
    this.clock.stop()

    const canvas = this.renderer?.domElement
    canvas?.removeEventListener('pointerdown', this.handlePointerDown, { capture: true })
    canvas?.removeEventListener('pointerup', this.handlePointerUp)
    canvas?.removeEventListener('pointercancel', this.handlePointerCancel)
    canvas?.removeEventListener('wheel', this.handleManualCameraInput, { capture: true })
    this.pointerDownPosition = null
    this.cameraTween = null
    this.onDevicePicked = null
    this.onAlarmFocused = null
    this.onPerformanceSample = null
    this.activeCriticalAlarmIds.clear()
    this.pendingCriticalAlarmId = null
    this.lastAlarmFocusTimeMs = Number.NEGATIVE_INFINITY

    this.controls?.dispose()
    this.controls = null

    if (this.scene) {
      disposeObjectTree(this.scene)
      this.scene.clear()
    }

    if (this.renderer) {
      this.renderer.renderLists.dispose()
      this.renderer.dispose()
      this.renderer.forceContextLoss()
      this.renderer.domElement.remove()
    }

    this.renderer = null
    this.camera = null
    this.scene = null
    this.instanceLayer = null
    this.agvController = null
    this.devices = []
    this.lineGroups.clear()
  }

  /**
   * Main scene loop. Delta time keeps AGV movement independent from monitor refresh rate.
   * The arrow function preserves the manager instance when passed to requestAnimationFrame.
   */
  private readonly renderLoop = (): void => {
    if (!this.scene || !this.camera || !this.renderer) {
      this.animationFrameId = null
      return
    }

    // Cap long background-tab gaps so an AGV never jumps across the workshop at once.
    const rawDeltaSeconds = this.clock.getDelta()
    const deltaSeconds = Math.min(rawDeltaSeconds, 0.05)

    // Camera, controls and moving scene objects update before drawing the frame.
    const tweening = this.updateCameraTween(deltaSeconds)
    if (!tweening) this.controls?.update()
    this.updateAgvs(deltaSeconds)
    this.instanceLayer?.updateAlarmBlink(deltaSeconds)
    this.updatePendingCriticalAlarmFocus()
    this.renderer.render(this.scene, this.camera)
    this.recordPerformance(rawDeltaSeconds * 1_000)

    this.animationFrameId = window.requestAnimationFrame(this.renderLoop)
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    this.cancelCameraTween()
    this.pointerDownPosition = { x: event.clientX, y: event.clientY }
  }

  private readonly handlePointerUp = (event: PointerEvent): void => {
    const start = this.pointerDownPosition
    this.pointerDownPosition = null
    if (!start || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5) return

    const device = this.pick(event)
    if (!device) return
    this.instanceLayer?.setSelected(device.id)
    this.onDevicePicked?.({ deviceId: device.id, lineId: device.lineId })
  }

  private readonly handlePointerCancel = (): void => {
    this.pointerDownPosition = null
  }

  private readonly handleManualCameraInput = (): void => {
    this.cancelCameraTween()
  }

  /** Interpolate both camera position and OrbitControls target with an ease-in-out curve. */
  private updateCameraTween(deltaSeconds: number): boolean {
    const tween = this.cameraTween
    if (!tween || !this.camera || !this.controls) return false

    tween.elapsedSeconds = Math.min(tween.elapsedSeconds + deltaSeconds, tween.durationSeconds)
    const progress = tween.elapsedSeconds / tween.durationSeconds
    const eased = progress < 0.5
      ? 4 * progress * progress * progress
      : 1 - Math.pow(-2 * progress + 2, 3) / 2

    this.camera.position.lerpVectors(tween.startPosition, tween.endPosition, eased)
    this.controls.target.lerpVectors(tween.startTarget, tween.endTarget, eased)
    this.camera.lookAt(this.controls.target)

    if (progress < 1) return true

    this.cameraTween = null
    this.controls.enabled = true
    this.controls.update()
    return false
  }

  /** Restore direct user control when a pointer or wheel gesture interrupts the tween. */
  private cancelCameraTween(): void {
    if (!this.cameraTween) return
    this.cameraTween = null
    if (this.controls) {
      this.controls.enabled = true
      this.controls.update()
    }
  }

  /** Focus immediately outside cooldown; otherwise retain the latest critical alarm. */
  private requestCriticalAlarmFocus(deviceId: string): void {
    const now = performance.now()
    if (now - this.lastAlarmFocusTimeMs >= FactorySceneManager.alarmFocusCooldownMs) {
      this.focusCriticalAlarm(deviceId, now)
      return
    }
    this.pendingCriticalAlarmId = deviceId
  }

  private reconcileCriticalAlarm(patch: DeviceStatusPatch): void {
    const device = this.instanceLayer?.getDevice(patch.deviceId)
    if (!device) return
    const alarmSeverity = patch.alarmSeverity ?? 'warning'
    device.alarmSeverity = patch.status === 'alarm' ? alarmSeverity : undefined

    const isCritical = patch.status === 'alarm' && alarmSeverity === 'critical'
    const wasCritical = this.activeCriticalAlarmIds.has(patch.deviceId)
    if (isCritical) {
      this.activeCriticalAlarmIds.add(patch.deviceId)
      if (!wasCritical) this.requestCriticalAlarmFocus(patch.deviceId)
      return
    }

    this.activeCriticalAlarmIds.delete(patch.deviceId)
    if (this.pendingCriticalAlarmId === patch.deviceId) this.pendingCriticalAlarmId = null
  }

  private updatePendingCriticalAlarmFocus(): void {
    const deviceId = this.pendingCriticalAlarmId
    if (!deviceId || !this.activeCriticalAlarmIds.has(deviceId)) return
    const now = performance.now()
    if (now - this.lastAlarmFocusTimeMs < FactorySceneManager.alarmFocusCooldownMs) return
    this.focusCriticalAlarm(deviceId, now)
  }

  private focusCriticalAlarm(deviceId: string, now: number): void {
    const device = this.instanceLayer?.getDevice(deviceId)
    if (!device) return
    this.pendingCriticalAlarmId = null
    this.lastAlarmFocusTimeMs = now
    this.focusOnDevice(deviceId)
    this.onAlarmFocused?.({ deviceId, lineId: device.lineId })
  }

  /** Aggregate frame timings locally and publish only once per second. */
  private recordPerformance(frameMs: number): void {
    if (!this.renderer) return
    const boundedFrameMs = Math.min(frameMs, 100)
    this.performanceFrameCount += 1
    this.performanceFrameTimeTotalMs += boundedFrameMs
    this.performanceMaxFrameMs = Math.max(this.performanceMaxFrameMs, boundedFrameMs)

    const now = performance.now()
    const elapsedMs = now - this.performanceWindowStartedAt
    if (elapsedMs < 1_000) return

    this.onPerformanceSample?.({
      fps: this.performanceFrameCount * 1_000 / elapsedMs,
      averageFrameMs: this.performanceFrameTimeTotalMs / Math.max(this.performanceFrameCount, 1),
      maxFrameMs: this.performanceMaxFrameMs,
      drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      geometries: this.renderer.info.memory.geometries,
      textures: this.renderer.info.memory.textures,
    })
    this.performanceWindowStartedAt = now
    this.performanceFrameCount = 0
    this.performanceFrameTimeTotalMs = 0
    this.performanceMaxFrameMs = 0
  }
}
