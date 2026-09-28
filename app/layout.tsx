import type { Metadata, Viewport } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import "./globals.css"
import { Toaster } from "@/components/ui/sonner"
import { DeploymentProfileBanner } from "@/components/deployment/deployment-profile-banner"
import { getDeploymentStatus } from "@/lib/deployment/profile"

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
})

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
})

export const metadata: Metadata = {
  title: "WilliamOS — Operator Shell",
  description:
    "WilliamOS is the Primary Operator's private command environment for governed work, evidence, memory, systems, and authority.",
}

export const viewport: Viewport = {
  themeColor: "#0b1220",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const deployment = getDeploymentStatus()

  return (
    <html lang="en" className="bg-background">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <DeploymentProfileBanner status={deployment} />
        {children}
        <Toaster theme="dark" />
      </body>
    </html>
  )
}
