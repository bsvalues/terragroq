"use client"

import { motion, useReducedMotion } from "motion/react"

import type { PrimaryHomeHealthState } from "@/components/primary-home/primary-home-model"

const HEALTH_COLOR: Record<PrimaryHomeHealthState, string> = {
  ADVANCING: "#54e0a3",
  BLOCKED: "#ff725f",
  AWAITING_REVIEW: "#59b8df",
  COMPLETE: "#d8dfd9",
  UNKNOWN: "#66716c",
}

const FIELD_LINES = [
  "M-80 176H340L430 266H860L950 176H1520",
  "M-80 438H230L320 348H690L790 448H1120L1210 358H1520",
  "M-80 706H380L468 618H900L990 706H1520",
] as const

const CHECKPOINTS = [
  { x: 330, y: 166 },
  { x: 850, y: 256 },
  { x: 220, y: 428 },
  { x: 680, y: 338 },
  { x: 1110, y: 438 },
  { x: 370, y: 696 },
  { x: 890, y: 608 },
] as const

export type OutcomeFieldBackgroundProps = Readonly<{
  health: PrimaryHomeHealthState
  active: boolean
}>

export function OutcomeFieldBackground({
  health,
  active,
}: OutcomeFieldBackgroundProps) {
  const reduceMotion = useReducedMotion()
  const color = HEALTH_COLOR[health]
  const animateRoutes = active && !reduceMotion

  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden"
      aria-hidden="true"
    >
      <svg
        className="h-full min-h-[42rem] w-full"
        viewBox="0 0 1440 900"
        preserveAspectRatio="xMidYMid slice"
        fill="none"
        focusable="false"
      >
        <g stroke="#2a3232" strokeWidth="1" opacity="0.36">
          <path d="M0 88H1440M0 264H1440M0 440H1440M0 616H1440M0 792H1440" />
          <path d="M144 0V900M432 0V900M720 0V900M1008 0V900M1296 0V900" />
        </g>

        <g stroke="#3c4745" strokeWidth="1" opacity="0.52">
          {FIELD_LINES.map((path) => (
            <path key={path} d={path} vectorEffect="non-scaling-stroke" />
          ))}
        </g>

        <g stroke={color} strokeWidth="1.5" opacity={active ? 0.48 : 0.22}>
          {FIELD_LINES.map((path, index) => (
            <motion.path
              key={path}
              d={path}
              pathLength={1}
              strokeDasharray="0.045 0.12"
              vectorEffect="non-scaling-stroke"
              initial={false}
              animate={{ strokeDashoffset: animateRoutes ? [0, -0.33] : 0 }}
              transition={animateRoutes ? {
                duration: 8 + index * 1.5,
                ease: "linear",
                repeat: Infinity,
              } : { duration: 0 }}
            />
          ))}
        </g>

        <g>
          {CHECKPOINTS.map(({ x, y }, index) => (
            <motion.rect
              key={`${x}-${y}`}
              x={x}
              y={y}
              width="20"
              height="20"
              fill="#0c0f10"
              stroke={index % 3 === 0 ? color : "#3c4745"}
              strokeWidth="1"
              initial={false}
              animate={{ opacity: animateRoutes ? [0.42, 0.9, 0.42] : 0.58 }}
              transition={animateRoutes ? {
                delay: index * 0.35,
                duration: 3.6,
                ease: "easeInOut",
                repeat: Infinity,
              } : { duration: 0 }}
            />
          ))}
        </g>

        <g stroke={color} strokeWidth="1" opacity="0.28">
          <path d="M90 88H260M1180 88H1350" />
          <path d="M90 812H260M1180 812H1350" />
          <path d="M90 76V100M1350 76V100M90 800V824M1350 800V824" />
        </g>
      </svg>
    </div>
  )
}
