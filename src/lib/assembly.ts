import type { Mesh } from './model.ts'
import { externalPair, internalPair, rackPair, radii, type BoreSpec, type GearSpec, type PairResult } from './involute.ts'
import type { PlacedGear } from './gearEntities.ts'

export interface RackPlacement {
  /** y of the rack pitch line (rack teeth point up toward the pinion). */
  y0: number
  /** x position of a tooth space centre. */
  offset: number
}

export interface Assembly {
  mesh: Mesh
  pair: PairResult
  gear1: PlacedGear
  gear2?: PlacedGear
  rack?: RackPlacement
}

/** Place the gears of a mesh for input rotation theta (rad, counter-clockwise) of gear 1. */
export function assemble(mesh: Mesh, g1: GearSpec, g2: GearSpec, bore1: BoreSpec, bore2: BoreSpec, theta: number): Assembly {
  if (mesh === 'external') {
    const pair = externalPair(g1, g2)
    return {
      mesh, pair,
      gear1: { spec: g1, bore: bore1, cx: 0, cy: 0, rotation: theta, layer: 'GEAR1' },
      gear2: { spec: g2, bore: bore2, cx: pair.a, cy: 0, rotation: Math.PI - Math.PI / g2.z - (theta * g1.z) / g2.z, layer: 'GEAR2' },
    }
  }
  if (mesh === 'internal') {
    const pair = internalPair(g1, g2)
    return {
      mesh, pair,
      gear1: { spec: g1, bore: bore1, cx: 0, cy: 0, rotation: theta, layer: 'GEAR1' },
      gear2: { spec: g2, bore: bore2, cx: -pair.a, cy: 0, rotation: Math.PI / g2.z + (theta * g1.z) / g2.z, layer: 'GEAR2' },
    }
  }
  const rp = rackPair(g1)
  const r1 = radii(g1).pitch
  return {
    mesh,
    pair: rp,
    gear1: { spec: g1, bore: bore1, cx: 0, cy: 0, rotation: -Math.PI / 2 + theta, layer: 'GEAR1' },
    rack: { y0: -rp.rackLineDistance, offset: r1 * theta },
  }
}
