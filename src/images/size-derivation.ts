export const MIN_IMAGE_AREA = 655_360
export const MAX_IMAGE_AREA = 8_294_400
export const MAX_IMAGE_EDGE = 3_840

const PRESET_RATIOS: Record<string, [number, number]> = {
  square: [1, 1],
  portrait: [2, 3],
  landscape: [3, 2],
}

export interface DeriveImageSizeOptions {
  inputWidth: number
  inputHeight: number
  width?: number
  height?: number
  aspectRatio?: string
  scale?: number
}

export interface ResolvedImageSize {
  width: number
  height: number
  value: string
}

function assertPositiveInteger(name: string, value: number | undefined): void {
  if (value == null) return
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }
}

function parseAspectRatio(value: string | undefined, inputWidth: number, inputHeight: number): number {
  const normalized = (value || 'auto').trim().toLowerCase()

  if (normalized === '' || normalized === 'auto') {
    return inputWidth / inputHeight
  }

  const preset = PRESET_RATIOS[normalized]
  if (preset) {
    return preset[0] / preset[1]
  }

  if (normalized.includes(':')) {
    const [left, right] = normalized.split(':', 2)
    const leftValue = Number(left)
    const rightValue = Number(right)
    if (!(leftValue > 0) || !(rightValue > 0)) {
      throw new Error('Aspect ratio components must be greater than 0')
    }
    return leftValue / rightValue
  }

  const numeric = Number(normalized)
  if (!(numeric > 0)) {
    throw new Error('Aspect ratio must be greater than 0')
  }

  return numeric
}

function snapToMultipleOf16(value: number): number {
  return Math.max(16, Math.round(value / 16) * 16)
}

export function deriveImageSize(options: DeriveImageSizeOptions): ResolvedImageSize {
  const scale = options.scale ?? 1
  if (!(scale > 0)) {
    throw new Error('--scale must be greater than 0')
  }

  assertPositiveInteger('--width', options.width)
  assertPositiveInteger('--height', options.height)

  const ratio = parseAspectRatio(options.aspectRatio, options.inputWidth, options.inputHeight)
  if (ratio > 3 || ratio < 1 / 3) {
    throw new Error('Aspect ratio must not exceed 3:1')
  }

  let targetWidth: number
  let targetHeight: number

  if (options.width && options.height) {
    targetWidth = options.width
    targetHeight = options.height
  } else if (options.width) {
    targetWidth = options.width
    targetHeight = targetWidth / ratio
  } else if (options.height) {
    targetHeight = options.height
    targetWidth = targetHeight * ratio
  } else {
    const area = options.inputWidth * options.inputHeight * (scale ** 2)
    targetWidth = Math.sqrt(area * ratio)
    targetHeight = Math.sqrt(area / ratio)
  }

  for (let i = 0; i < 12; i += 1) {
    const areaNow = targetWidth * targetHeight
    const edgeNow = Math.max(targetWidth, targetHeight)

    if (edgeNow > MAX_IMAGE_EDGE) {
      const factor = MAX_IMAGE_EDGE / edgeNow
      targetWidth *= factor
      targetHeight *= factor
      continue
    }

    if (areaNow > MAX_IMAGE_AREA) {
      const factor = Math.sqrt(MAX_IMAGE_AREA / areaNow)
      targetWidth *= factor
      targetHeight *= factor
      continue
    }

    if (areaNow < MIN_IMAGE_AREA) {
      const factor = Math.sqrt(MIN_IMAGE_AREA / areaNow)
      targetWidth *= factor
      targetHeight *= factor
      continue
    }

    break
  }

  let width = snapToMultipleOf16(targetWidth)
  let height = snapToMultipleOf16(targetHeight)

  while (Math.max(width, height) > MAX_IMAGE_EDGE || (width * height) > MAX_IMAGE_AREA) {
    if (width >= height) {
      width -= 16
    } else {
      height -= 16
    }

    if (width < 16 || height < 16) {
      throw new Error('Unable to derive a valid size from the requested parameters')
    }
  }

  while ((width * height) < MIN_IMAGE_AREA) {
    if ((width / height) >= ratio) {
      height += 16
    } else {
      width += 16
    }

    if (Math.max(width, height) > MAX_IMAGE_EDGE || (width * height) > MAX_IMAGE_AREA) {
      throw new Error('Derived size fell below minimum area and could not be expanded within limits')
    }
  }

  if ((width / height) > 3 || (height / width) > 3) {
    throw new Error('Derived size violates the 3:1 aspect-ratio limit')
  }

  return {
    width,
    height,
    value: `${width}x${height}`,
  }
}

export function shouldDeriveImageSize(options: {
  width?: number
  height?: number
  aspectRatio?: string
  scale?: number
}): boolean {
  return options.width != null
    || options.height != null
    || ((options.aspectRatio || 'auto') !== 'auto')
    || (options.scale != null && options.scale !== 1)
}

export function validateExplicitSize(value: string): string {
  if (value !== 'auto' && !/^\d+x\d+$/.test(value)) {
    throw new Error('--size must be "auto" or of the form WIDTHxHEIGHT')
  }

  return value
}
