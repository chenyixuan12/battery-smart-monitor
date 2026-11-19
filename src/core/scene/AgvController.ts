import {
  BoxGeometry,
  BufferGeometry,
  CatmullRomCurve3,
  Group,
  Line,
  LineDashedMaterial,
  Mesh,
  MeshStandardMaterial,
  Vector3,
} from 'three'

interface AgvUnit { group: Group; route: CatmullRomCurve3; progress: number; speed: number }

/** Creates simple AGV carts and advances them along closed geometry-only routes. */
export class AgvController {
  private readonly units: AgvUnit[] = []

  constructor(private readonly parent: Group, count = 4) {
    const routes = [-6, 6].map((z, index) => {
      const route = this.createRoute(z)
      this.addRouteVisualization(route, index)
      return route
    })
    for (let index = 0; index < count; index += 1) {
      this.addAgv(index, count, routes[index % routes.length]!)
    }
  }

  /** Advance AGV positions by elapsed seconds; call from the future scene render loop. */
  update(deltaSeconds: number): void {
    for (const unit of this.units) {
      unit.progress = (unit.progress + deltaSeconds * unit.speed) % 1
      const point = unit.route.getPointAt(unit.progress)
      const tangent = unit.route.getTangentAt(unit.progress)
      unit.group.position.set(point.x, 0.18, point.z)
      unit.group.rotation.y = Math.atan2(tangent.x, tangent.z)
    }
  }

  private addAgv(index: number, count: number, route: CatmullRomCurve3): void {
    const group = new Group()
    group.name = `agv-${index + 1}`
    const base = new Mesh(new BoxGeometry(0.78, 0.22, 0.58), new MeshStandardMaterial({ color: 0x4d9fb2, metalness: 0.3, roughness: 0.5 }))
    base.position.y = 0.16
    const payload = new Mesh(new BoxGeometry(0.38, 0.3, 0.34), new MeshStandardMaterial({ color: 0x9bb8b5, roughness: 0.75 }))
    payload.position.y = 0.41
    group.add(base, payload)
    this.parent.add(group)
    this.units.push({ group, route, progress: index / count, speed: 0.035 + index * 0.004 })
    this.update(0)
  }

  private createRoute(z: number): CatmullRomCurve3 {
    return new CatmullRomCurve3([
      new Vector3(-9.5, 0, z),
      new Vector3(-7, 0, z + 0.7),
      new Vector3(0, 0, z + 0.45),
      new Vector3(8, 0, z - 0.4),
      new Vector3(9.5, 0, z),
      new Vector3(4, 0, z + 0.6),
      new Vector3(-6, 0, z - 0.3),
    ], true, 'centripetal')
  }

  /** Draw the exact sampled curve used by AGV movement, so visual and motion paths cannot drift. */
  private addRouteVisualization(route: CatmullRomCurve3, index: number): void {
    const points = route.getSpacedPoints(160).map((point) => point.clone().setY(0.035))
    const geometry = new BufferGeometry().setFromPoints(points)
    const material = new LineDashedMaterial({
      color: index === 0 ? 0x3d8f91 : 0x427f94,
      transparent: true,
      opacity: 0.62,
      dashSize: 0.32,
      gapSize: 0.2,
    })
    const routeLine = new Line(geometry, material)
    routeLine.name = `agv-route-${index + 1}`
    routeLine.computeLineDistances()
    routeLine.renderOrder = 1
    this.parent.add(routeLine)
  }
}
