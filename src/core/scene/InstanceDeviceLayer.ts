import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  DynamicDrawUsage,
  EdgesGeometry,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  Raycaster,
  Scene,
  StaticDrawUsage,
  Vector2,
} from 'three'
import type { DeviceStatus, DeviceStatusPatch } from '../../types'
import type { FactoryDevice } from './types'

/**
 * Public contract for the batched device layer.
 * Batches device parts into three InstancedMesh draw calls and owns device status colors.
 */
export class InstanceDeviceLayer {
  private static readonly statusColors: Record<DeviceStatus, Color> = {
    normal: new Color(0x44d6b1),
    idle: new Color(0xf3b653),
    alarm: new Color(0xef6d68),
  }

  private readonly raycaster = new Raycaster()
  private readonly pointer = new Vector2()
  private readonly deviceById = new Map<string, FactoryDevice>()
  private readonly instanceIdByDeviceId = new Map<string, number>()
  private readonly pickTargets: Object3D[] = []
  private readonly instanceDeviceIds = new WeakMap<InstancedMesh, readonly string[]>()
  private readonly alarmInstanceIds = new Set<number>()
  private readonly alarmColor = new Color()
  private readonly root = new Group()
  private readonly bodyMesh: InstancedMesh
  private readonly capMesh: InstancedMesh
  private readonly beaconMesh: InstancedMesh
  private readonly selectionMarker: LineSegments
  private alarmElapsedSeconds = 0
  private alarmUploadAccumulator = 0

  constructor(
    private readonly scene: Scene,
    private readonly camera: PerspectiveCamera,
    devices: FactoryDevice[],
  ) {
    for (const device of devices) this.deviceById.set(device.id, device)
    this.root.name = 'instance-device-layer'

    this.bodyMesh = new InstancedMesh(
      new BoxGeometry(0.46, 0.82, 0.94),
      new MeshStandardMaterial({ color: 0xffffff, metalness: 0.24, roughness: 0.58 }),
      devices.length,
    )
    this.bodyMesh.name = 'device-bodies'
    this.capMesh = new InstancedMesh(
      new BoxGeometry(0.34, 0.12, 0.76),
      new MeshStandardMaterial({ color: 0x61777a, metalness: 0.25, roughness: 0.55 }),
      devices.length,
    )
    this.capMesh.name = 'device-caps'
    this.beaconMesh = new InstancedMesh(
      new CylinderGeometry(0.1, 0.1, 0.08, 12),
      new MeshStandardMaterial({ color: 0xffffff, emissive: 0x202020, emissiveIntensity: 0.5 }),
      devices.length,
    )
    this.beaconMesh.name = 'device-beacons'

    const selectionSource = new BoxGeometry(0.58, 1.02, 1.08)
    this.selectionMarker = new LineSegments(
      new EdgesGeometry(selectionSource),
      new LineBasicMaterial({ color: 0x7ef4da, transparent: true, opacity: 0.95, depthTest: false }),
    )
    selectionSource.dispose()
    this.selectionMarker.name = 'selected-device-marker'
    this.selectionMarker.renderOrder = 10
    this.selectionMarker.visible = false

    this.populateInstances(devices)
    this.root.add(this.bodyMesh, this.capMesh, this.beaconMesh, this.selectionMarker)
    this.scene.add(this.root)
  }

  /** Update the visual status of one device. */
  updateDeviceStatus(deviceId: string, status: DeviceStatus): void {
    this.updateDeviceStatuses([{ deviceId, status }])
  }

  /** Update many instance color slots and upload each shared GPU color buffer only once. */
  updateDeviceStatuses(patches: readonly DeviceStatusPatch[]): void {
    let changed = false
    for (const patch of patches) {
      const instanceId = this.instanceIdByDeviceId.get(patch.deviceId)
      const device = this.deviceById.get(patch.deviceId)
      if (instanceId === undefined || !device) continue

      const color = InstanceDeviceLayer.statusColors[patch.status]
      this.bodyMesh.setColorAt(instanceId, color)
      this.beaconMesh.setColorAt(instanceId, color)
      if (patch.status === 'alarm') this.alarmInstanceIds.add(instanceId)
      else this.alarmInstanceIds.delete(instanceId)
      device.status = patch.status
      changed = true
    }

    if (!changed) return
    // setColorAt writes CPU-side attributes; one needsUpdate uploads the full batch next draw.
    if (this.bodyMesh.instanceColor) this.bodyMesh.instanceColor.needsUpdate = true
    if (this.beaconMesh.instanceColor) this.beaconMesh.instanceColor.needsUpdate = true
  }

  /** Pulse alarm instances without touching normal or idle device color slots. */
  updateAlarmBlink(deltaSeconds: number): void {
    if (this.alarmInstanceIds.size === 0) return

    this.alarmElapsedSeconds += deltaSeconds
    this.alarmUploadAccumulator += deltaSeconds

    // Instance colors live in one GPU buffer; 15 Hz is visually clear without uploading every frame.
    if (this.alarmUploadAccumulator < 1 / 15) return
    this.alarmUploadAccumulator %= 1 / 15

    const wave = 0.5 + 0.5 * Math.sin(this.alarmElapsedSeconds * Math.PI * 3)
    this.alarmColor.setRGB(
      0.32 + wave * 0.62,
      0.035 + wave * 0.12,
      0.025 + wave * 0.1,
    )

    for (const instanceId of this.alarmInstanceIds) {
      this.bodyMesh.setColorAt(instanceId, this.alarmColor)
      this.beaconMesh.setColorAt(instanceId, this.alarmColor)
    }

    if (this.bodyMesh.instanceColor) this.bodyMesh.instanceColor.needsUpdate = true
    if (this.beaconMesh.instanceColor) this.beaconMesh.instanceColor.needsUpdate = true
  }

  /** Resolve a raycast hit from pointer coordinates to a factory device. */
  pick(clientX: number, clientY: number, bounds: DOMRect): FactoryDevice | null {
    if (bounds.width <= 0 || bounds.height <= 0) return null

    // DOM coordinates start at the top-left; WebGL NDC ranges from -1 to 1 with Y upward.
    this.pointer.x = ((clientX - bounds.left) / bounds.width) * 2 - 1
    this.pointer.y = -((clientY - bounds.top) / bounds.height) * 2 + 1
    this.raycaster.setFromCamera(this.pointer, this.camera)

    const intersections = this.raycaster.intersectObjects(this.pickTargets, false)
    for (const intersection of intersections) {
      const object = intersection.object

      // Future InstancedMesh hits expose instanceId rather than one object per device.
      if (object instanceof InstancedMesh && intersection.instanceId !== undefined) {
        const deviceId = this.instanceDeviceIds.get(object)?.[intersection.instanceId]
        if (deviceId) return this.deviceById.get(deviceId) ?? null
      }

      const deviceId = this.findDeviceId(object)
      if (deviceId) return this.deviceById.get(deviceId) ?? null
    }

    return null
  }

  /**
   * Register an InstancedMesh-to-device ordering once instance batching is implemented.
   * The array index must match the instanceId written into that mesh.
   */
  registerInstancedMesh(mesh: InstancedMesh, deviceIds: readonly string[]): void {
    this.instanceDeviceIds.set(mesh, deviceIds)
    if (!this.pickTargets.includes(mesh)) this.pickTargets.push(mesh)
  }

  /** Move one reusable wireframe marker without changing the device's status color. */
  setSelected(deviceId: string | null): void {
    if (!deviceId) {
      this.selectionMarker.visible = false
      return
    }

    const device = this.deviceById.get(deviceId)
    if (!device) {
      this.selectionMarker.visible = false
      return
    }

    this.selectionMarker.position.set(device.position.x, 0.76, device.position.z)
    this.selectionMarker.visible = true
  }

  /** Metadata access for camera focus and the Vue bridge. */
  getDevice(deviceId: string): FactoryDevice | undefined {
    return this.deviceById.get(deviceId)
  }

  private populateInstances(devices: FactoryDevice[]): void {
    const transform = new Object3D()
    const deviceIds: string[] = []

    devices.forEach((device, instanceId) => {
      this.instanceIdByDeviceId.set(device.id, instanceId)
      deviceIds.push(device.id)

      transform.position.set(device.position.x, 0.72, device.position.z)
      transform.updateMatrix()
      this.bodyMesh.setMatrixAt(instanceId, transform.matrix)

      transform.position.set(device.position.x, 1.18, device.position.z)
      transform.updateMatrix()
      this.capMesh.setMatrixAt(instanceId, transform.matrix)

      transform.position.set(device.position.x + 0.11, 1.29, device.position.z - 0.31)
      transform.updateMatrix()
      this.beaconMesh.setMatrixAt(instanceId, transform.matrix)

      const color = InstanceDeviceLayer.statusColors[device.status]
      this.bodyMesh.setColorAt(instanceId, color)
      this.beaconMesh.setColorAt(instanceId, color)
      if (device.status === 'alarm') this.alarmInstanceIds.add(instanceId)
    })

    for (const mesh of [this.bodyMesh, this.capMesh, this.beaconMesh]) {
      mesh.instanceMatrix.setUsage(StaticDrawUsage)
      mesh.instanceMatrix.needsUpdate = true
      mesh.computeBoundingSphere()
      this.registerInstancedMesh(mesh, deviceIds)
    }

    // Status colors change often; tell WebGL that these two attributes are dynamic buffers.
    this.bodyMesh.instanceColor?.setUsage(DynamicDrawUsage)
    this.beaconMesh.instanceColor?.setUsage(DynamicDrawUsage)
    if (this.bodyMesh.instanceColor) this.bodyMesh.instanceColor.needsUpdate = true
    if (this.beaconMesh.instanceColor) this.beaconMesh.instanceColor.needsUpdate = true
  }

  /** Walk upward to support a future device Group with several mesh children. */
  private findDeviceId(object: Object3D): string | null {
    let current: Object3D | null = object
    while (current) {
      if (typeof current.userData.deviceId === 'string') return current.userData.deviceId
      current = current.parent
    }
    return null
  }
}
