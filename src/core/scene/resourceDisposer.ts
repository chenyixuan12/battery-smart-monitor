import { Line, Mesh, Texture, type BufferGeometry, type Material, type Object3D } from 'three'

/** Dispose GPU resources below one Object3D while handling shared assets only once. */
export function disposeObjectTree(root: Object3D): void {
  const geometries = new Set<BufferGeometry>()
  const materials = new Set<Material>()
  const textures = new Set<Texture>()

  root.traverse((object) => {
    if (!(object instanceof Mesh) && !(object instanceof Line)) return
    geometries.add(object.geometry)
    const objectMaterials = Array.isArray(object.material) ? object.material : [object.material]
    for (const material of objectMaterials) materials.add(material)
  })

  // Standard material texture slots are direct material properties (map, normalMap, etc.).
  for (const material of materials) {
    for (const value of Object.values(material)) {
      if (value instanceof Texture) textures.add(value)
    }
  }

  for (const texture of textures) texture.dispose()
  for (const material of materials) material.dispose()
  for (const geometry of geometries) geometry.dispose()
}
