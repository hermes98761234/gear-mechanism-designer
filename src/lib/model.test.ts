import { describe, expect, it } from 'vitest'
import { defaultState, mergeInto, sanitize } from './model.ts'

describe('state sanitising', () => {
  it('returns defaults for junk', () => {
    expect(sanitize(null)).toEqual(sanitize(undefined))
    expect(sanitize('x').tab).toBe('gears')
  })
  it('keeps valid saved values and drops invalid ones', () => {
    const s = sanitize({ theme: 'dark', gear: { z1: 25.4, module: 'big', mesh: 'rack' }, cam: { baseRadius: 55, segments: [{ law: 'bogus', beta: 1, lift: 1 }] } })
    expect(s.theme).toBe('dark')
    expect(s.gear.z1).toBe(25)
    expect(s.gear.module).toBe(defaultState().gear.module)
    expect(s.gear.mesh).toBe('rack')
    expect(s.cam.baseRadius).toBe(55)
    expect(s.cam.segments).toEqual(defaultState().cam.segments)
  })
  it('rejects NaN numbers and mismatched tuples', () => {
    expect(mergeInto(5, Number.NaN)).toBe(5)
    expect(mergeInto([0, 0], [1])).toEqual([0, 0])
    expect(mergeInto([0, 0], [1, 2])).toEqual([1, 2])
  })
  it('accepts valid custom segments', () => {
    const segs = [{ law: 'harmonic', beta: 360, lift: 0 }]
    expect(sanitize({ cam: { segments: segs } }).cam.segments).toEqual(segs)
  })
})
