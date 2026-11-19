import type { AlarmSeverity, DefectCategory, DeviceStatus, DeviceTelemetryEvent } from '../../shared/telemetry.js'

const defectCategories: readonly DefectCategory[] = ['焊接不良', '气密不良', '尺寸异常', '电压异常', '外观缺陷']

export type SimulatorProfile = 'demo' | 'load' | 'stress'

interface DeviceState {
  deviceId: string
  status: DeviceStatus
  alarmSeverity?: AlarmSeverity
  temperature: number
  voltage: number
  current: number
  oee: number
}

export interface TelemetrySimulatorOptions {
  profile?: SimulatorProfile
  deviceCount?: number
  batchSize?: number
  intervalMs?: number
  seed?: number
  burstEveryMs?: number
  burstDurationMs?: number
  burstMultiplier?: number
}

export interface SimulatorStats {
  profile: SimulatorProfile
  deviceCount: number
  batchSize: number
  intervalMs: number
  seed: number
  emittedEvents: number
  emittedBatches: number
  eventsPerSecond: number
  burstActive: boolean
  nextBurstInMs: number | null
}

interface ResolvedSimulatorOptions {
  profile: SimulatorProfile
  deviceCount: number
  batchSize: number
  intervalMs: number
  seed: number
  burstEveryMs: number
  burstDurationMs: number
  burstMultiplier: number
}

const profiles: Record<SimulatorProfile, Omit<ResolvedSimulatorOptions, 'profile' | 'seed'>> = {
  demo: { deviceCount: 180, batchSize: 200, intervalMs: 50, burstEveryMs: 0, burstDurationMs: 0, burstMultiplier: 1 },
  load: { deviceCount: 1_000, batchSize: 1_000, intervalMs: 50, burstEveryMs: 15_000, burstDurationMs: 3_000, burstMultiplier: 3 },
  stress: { deviceCount: 5_000, batchSize: 2_500, intervalMs: 50, burstEveryMs: 15_000, burstDurationMs: 3_000, burstMultiplier: 2 },
}

function createRandom(seed: number): () => number {
  let value = seed >>> 0
  return () => {
    value += 0x6D2B79F5
    let result = value
    result = Math.imul(result ^ result >>> 15, result | 1)
    result ^= result + Math.imul(result ^ result >>> 7, result | 61)
    return ((result ^ result >>> 14) >>> 0) / 4_294_967_296
  }
}

function resolveOptions(options: TelemetrySimulatorOptions): ResolvedSimulatorOptions {
  const profile = options.profile ?? 'demo'
  const defaults = profiles[profile]
  return {
    profile,
    deviceCount: options.deviceCount ?? defaults.deviceCount,
    batchSize: options.batchSize ?? defaults.batchSize,
    intervalMs: options.intervalMs ?? defaults.intervalMs,
    seed: options.seed ?? 20_261_111,
    burstEveryMs: options.burstEveryMs ?? defaults.burstEveryMs,
    burstDurationMs: options.burstDurationMs ?? defaults.burstDurationMs,
    burstMultiplier: options.burstMultiplier ?? defaults.burstMultiplier,
  }
}

function parsePositiveInteger(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}

export function createSimulatorFromEnvironment(environment: NodeJS.ProcessEnv = process.env): TelemetrySimulator {
  const profile = environment.SIMULATOR_PROFILE
  const selectedProfile: SimulatorProfile = profile === 'load' || profile === 'stress' ? profile : 'demo'
  return new TelemetrySimulator({
    profile: selectedProfile,
    deviceCount: parsePositiveInteger(environment.SIMULATOR_DEVICE_COUNT),
    batchSize: parsePositiveInteger(environment.SIMULATOR_BATCH_SIZE),
    intervalMs: parsePositiveInteger(environment.SIMULATOR_INTERVAL_MS),
    seed: parsePositiveInteger(environment.SIMULATOR_SEED),
    burstEveryMs: parsePositiveInteger(environment.SIMULATOR_BURST_EVERY_MS),
    burstDurationMs: parsePositiveInteger(environment.SIMULATOR_BURST_DURATION_MS),
    burstMultiplier: parsePositiveInteger(environment.SIMULATOR_BURST_MULTIPLIER),
  })
}

/** Deterministic, configurable high-frequency telemetry source for local load testing. */
export class TelemetrySimulator {
  private readonly options: ResolvedSimulatorOptions
  private readonly random: () => number
  private readonly devices: DeviceState[]
  private readonly normalBuffer: DeviceTelemetryEvent[]
  private readonly burstBuffer: DeviceTelemetryEvent[]
  private timer: NodeJS.Timeout | null = null
  private cursor = 0
  private listener: ((events: readonly DeviceTelemetryEvent[]) => void) | null = null
  private startedAt: number | null = null
  private emittedEvents = 0
  private emittedBatches = 0

  constructor(options: TelemetrySimulatorOptions = {}) {
    this.options = resolveOptions(options)
    this.random = createRandom(this.options.seed)
    this.devices = Array.from({ length: this.options.deviceCount }, (_, index) => this.createDevice(index))
    this.normalBuffer = this.createEventBuffer(this.options.batchSize)
    this.burstBuffer = this.createEventBuffer(Math.ceil(this.options.batchSize * this.options.burstMultiplier))
  }

  subscribe(listener: (events: readonly DeviceTelemetryEvent[]) => void): void {
    this.listener = listener
  }

  start(): void {
    if (this.timer) return
    this.startedAt = Date.now()
    this.timer = setInterval(() => this.emitBatch(), this.options.intervalMs)
  }

  stop(): void {
    if (!this.timer) return
    clearInterval(this.timer)
    this.timer = null
    this.startedAt = null
  }

  getStats(): SimulatorStats {
    const now = Date.now()
    const elapsedMs = this.startedAt === null ? 0 : Math.max(now - this.startedAt, 1)
    const burstActive = this.isBurstActive(now)
    return {
      profile: this.options.profile,
      deviceCount: this.options.deviceCount,
      batchSize: this.options.batchSize,
      intervalMs: this.options.intervalMs,
      seed: this.options.seed,
      emittedEvents: this.emittedEvents,
      emittedBatches: this.emittedBatches,
      eventsPerSecond: elapsedMs === 0 ? 0 : Math.round(this.emittedEvents * 1_000 / elapsedMs),
      burstActive,
      nextBurstInMs: this.getNextBurstInMs(now),
    }
  }

  private emitBatch(): void {
    const now = Date.now()
    const burstActive = this.isBurstActive(now)
    const buffer = burstActive ? this.burstBuffer : this.normalBuffer
    const transitionRate = burstActive ? 0.01 : 0.002
    for (let index = 0; index < buffer.length; index += 1) {
      const device = this.devices[this.cursor % this.devices.length]!
      this.cursor += 1
      this.maybeTransitionStatus(device, transitionRate, burstActive)
      device.temperature = this.clamp(device.temperature + (this.random() - 0.5) * 0.28, 20, 58)
      device.voltage = this.clamp(device.voltage + (this.random() - 0.5) * 0.018, 3.2, 4.25)
      device.current = this.clamp(device.current + (this.random() - 0.5) * 1.6, 45, 130)
      device.oee = this.clamp(device.oee + (this.random() - 0.5) * 0.45, 68, 99.5)

      const outputDelta = this.random() < 0.07 ? 1 : 0
      const qualityRoll = this.random()
      const reworkDelta = outputDelta && qualityRoll >= 0.9862 && qualityRoll < 0.997 ? 1 : 0
      const scrapDelta = outputDelta && qualityRoll >= 0.997 ? 1 : 0
      const event = buffer[index]!
      event.deviceId = device.deviceId
      event.status = device.status
      event.alarmSeverity = device.alarmSeverity
      event.temperature = device.temperature
      event.voltage = device.voltage
      event.current = device.current
      event.oee = device.oee
      event.outputDelta = outputDelta
      event.qualifiedDelta = outputDelta && qualityRoll < 0.9862 ? 1 : 0
      event.reworkDelta = reworkDelta
      event.scrapDelta = scrapDelta
      event.energyDelta = device.status === 'normal' ? 0.0007 + this.random() * 0.0005 : 0.0002
      event.defectType = reworkDelta || scrapDelta
        ? defectCategories[Math.floor(this.random() * defectCategories.length)]
        : undefined
      event.timestamp = now
    }
    this.emittedEvents += buffer.length
    this.emittedBatches += 1
    this.listener?.(buffer)
  }

  private createEventBuffer(size: number): DeviceTelemetryEvent[] {
    return Array.from({ length: size }, () => ({
      deviceId: '', status: 'normal', temperature: 0, voltage: 0, current: 0, oee: 0,
      outputDelta: 0, qualifiedDelta: 0, reworkDelta: 0, scrapDelta: 0, energyDelta: 0, timestamp: 0,
    }))
  }

  private createDevice(index: number): DeviceState {
    const lineIndex = Math.floor(index / 30)
    const stationIndex = index % 30
    const status: DeviceStatus = lineIndex === 2 && stationIndex === 3
      ? 'alarm'
      : (lineIndex + stationIndex) % 9 === 0 ? 'idle' : 'normal'
    return {
      deviceId: `PACK-${String(lineIndex + 1).padStart(2, '0')}-EQ-${String(stationIndex + 1).padStart(2, '0')}`,
      status,
      alarmSeverity: status === 'alarm' ? 'critical' : undefined,
      temperature: 28 + this.random() * 8,
      voltage: 3.55 + this.random() * 0.35,
      current: 70 + this.random() * 25,
      oee: 82 + this.random() * 10,
    }
  }

  private maybeTransitionStatus(device: DeviceState, transitionRate: number, burstActive: boolean): void {
    if (this.random() >= transitionRate) return
    const roll = this.random()
    const alarmThreshold = burstActive ? 0.18 : 0.02
    const idleThreshold = burstActive ? 0.30 : 0.06
    device.status = roll < 1 - idleThreshold - alarmThreshold ? 'normal' : roll < 1 - alarmThreshold ? 'idle' : 'alarm'
    device.alarmSeverity = device.status === 'alarm'
      ? (this.random() < 0.25 ? 'critical' : 'warning')
      : undefined
  }

  private isBurstActive(now: number): boolean {
    if (this.startedAt === null || this.options.burstEveryMs <= 0 || this.options.burstDurationMs <= 0) return false
    const elapsed = now - this.startedAt
    return elapsed > 0 && elapsed % this.options.burstEveryMs < this.options.burstDurationMs
  }

  private getNextBurstInMs(now: number): number | null {
    if (this.startedAt === null || this.options.burstEveryMs <= 0 || this.options.burstDurationMs <= 0) return null
    const elapsed = now - this.startedAt
    const cyclePosition = elapsed % this.options.burstEveryMs
    if (this.isBurstActive(now)) return 0
    return this.options.burstEveryMs - cyclePosition
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max)
  }
}
