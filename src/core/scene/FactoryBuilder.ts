import { BoxGeometry, Group, Mesh, MeshStandardMaterial, type Scene, Vector3 } from 'three'
import type { DeviceStatus } from '../../types'
import type { FactoryBuildResult, FactoryDevice, FactoryLine } from './types'

const colors = { floor: 0x142127, line: 0x294148, conveyor: 0x24363c }
const stationNames = ['上料', '电芯检测', '激光焊接', 'PACK装配', '气密测试', '下线']

/** Builds a lightweight PACK workshop entirely from Three.js primitive geometry. */
export class FactoryBuilder {
  build(scene: Scene): FactoryBuildResult {
    const root = new Group()
    root.name = 'pack-factory-root'
    const lines = Array.from({ length: 6 }, (_, index) => ({ id: `PACK-${String(index + 1).padStart(2, '0')}`, name: `PACK ${String(index + 1).padStart(2, '0')} 产线`, z: -7.5 + index * 3, length: 20 }))
    const devices: FactoryDevice[] = []
    const lineGroups = new Map<string, Group>()
    this.addFloor(root)
    lines.forEach((line, lineIndex) => {
      const lineGroup = this.addLine(line)
      lineGroups.set(line.id, lineGroup)
      root.add(lineGroup)
      for (let stationIndex = 0; stationIndex < 30; stationIndex += 1) {
        const status = this.initialStatus(lineIndex, stationIndex)
        const device: FactoryDevice = {
          id: `${line.id}-EQ-${String(stationIndex + 1).padStart(2, '0')}`,
          name: `${line.name} ${stationNames[stationIndex % stationNames.length]}`,
          lineId: line.id,
          stationIndex,
          position: new Vector3(-9.28 + stationIndex * 0.64, 0, line.z),
          status,
          alarmSeverity: status === 'alarm' ? 'critical' : undefined,
        }
        devices.push(device)
      }
    })
    scene.add(root)
    return { root, devices, lines, lineGroups }
  }

  private addFloor(root: Group): void {
    const material = new MeshStandardMaterial({ color: colors.floor, roughness: 0.88 })
    const floor = new Mesh(new BoxGeometry(24, 0.12, 20), material)
    floor.position.y = -0.08
    root.add(floor)
    const lineMaterial = new MeshStandardMaterial({ color: colors.line, roughness: 1 })
    for (let x = -10; x <= 10; x += 2) {
      const guide = new Mesh(new BoxGeometry(0.025, 0.012, 18), lineMaterial)
      guide.position.set(x, 0, 0)
      root.add(guide)
    }
  }

  private addLine(line: FactoryLine): Group {
    const lineGroup = new Group()
    lineGroup.name = `${line.id}-group`
    lineGroup.userData.lineId = line.id
    const beltMaterial = new MeshStandardMaterial({ color: colors.conveyor, metalness: 0.35, roughness: 0.68 })
    const belt = new Mesh(new BoxGeometry(line.length, 0.18, 0.72), beltMaterial)
    belt.name = `${line.id}-conveyor`
    belt.position.set(0, 0.24, line.z)
    lineGroup.add(belt)
    const railMaterial = new MeshStandardMaterial({ color: 0x587176, metalness: 0.25, roughness: 0.65 })
    for (const zOffset of [-0.48, 0.48]) {
      const rail = new Mesh(new BoxGeometry(line.length, 0.1, 0.07), railMaterial)
      rail.position.set(0, 0.37, line.z + zOffset)
      lineGroup.add(rail)
    }
    return lineGroup
  }

  private initialStatus(lineIndex: number, stationIndex: number): DeviceStatus {
    if (lineIndex === 2 && stationIndex === 3) return 'alarm'
    return (lineIndex + stationIndex) % 9 === 0 ? 'idle' : 'normal'
  }
}
