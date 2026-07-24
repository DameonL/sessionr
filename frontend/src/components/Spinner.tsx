"use client";

export function Spinner({ size = 28 }: { size?: number }) {
  return (
    <div
      className="spinner"
      style={{ width: size, height: size }}
      role="status"
      aria-label="Loading"
    />
  )
}
