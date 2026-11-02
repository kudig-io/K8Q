let s = 42

export function rand() {
  s = (s * 1664525 + 1013904223) % 4294967296
  return s / 4294967296
}

export function randInt(min: number, max: number) {
  return Math.floor(rand() * (max - min + 1)) + min
}

export function pick<T>(arr: T[]): T {
  return arr[Math.floor(rand() * arr.length)]
}

export function uid() {
  return Math.random().toString(36).slice(2, 10)
}
