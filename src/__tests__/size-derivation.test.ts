import { describe, expect, it } from 'bun:test'
import {
  MAX_IMAGE_AREA,
  MAX_IMAGE_EDGE,
  MIN_IMAGE_AREA,
  deriveImageSize,
} from '../images/size-derivation.ts'

describe('deriveImageSize', () => {
  it('derives a portrait size from width and aspect ratio', () => {
    expect(deriveImageSize({
      inputWidth: 4000,
      inputHeight: 3000,
      width: 1024,
      aspectRatio: '2:3',
    })).toEqual({
      width: 1024,
      height: 1536,
      value: '1024x1536',
    })
  })

  it('scales up small inputs to the minimum supported area', () => {
    const result = deriveImageSize({
      inputWidth: 800,
      inputHeight: 600,
    })

    expect(result).toEqual({
      width: 944,
      height: 704,
      value: '944x704',
    })
    expect(result.width * result.height).toBeGreaterThanOrEqual(MIN_IMAGE_AREA)
  })

  it('clamps oversized requests into documented limits', () => {
    const result = deriveImageSize({
      inputWidth: 5000,
      inputHeight: 5000,
      width: 4096,
      height: 4096,
    })

    expect(result.width).toBeLessThanOrEqual(MAX_IMAGE_EDGE)
    expect(result.height).toBeLessThanOrEqual(MAX_IMAGE_EDGE)
    expect(result.width * result.height).toBeLessThanOrEqual(MAX_IMAGE_AREA)
  })

  it('rejects aspect ratios beyond 3:1', () => {
    expect(() => deriveImageSize({
      inputWidth: 2000,
      inputHeight: 1000,
      aspectRatio: '4:1',
    })).toThrow('Aspect ratio must not exceed 3:1')
  })
})
