import React, { lazy, Suspense, useCallback } from 'react'
import {
  Link as RouterLink,
  useLocation,
  useNavigate,
  useParams as useRRParams,
  useSearchParams as useRRSearchParams,
} from 'react-router-dom'

/**
 * Router Compatibility Adapter for SPA rendering.
 * Provides Link, useRouter, usePathname, useSearchParams, useParams, dynamic, redirect, and Image.
 */

export function Link({
  href,
  to,
  children,
  className,
  onClick,
  prefetch,
  ...props
}: {
  href?: string
  to?: string
  children?: React.ReactNode
  className?: string
  onClick?: React.MouseEventHandler<HTMLAnchorElement>
  prefetch?: boolean
  [key: string]: unknown
}) {
  const destination = href || to || '/'
  const isExternal = destination.startsWith('http://') || destination.startsWith('https://') || destination.startsWith('//')

  if (isExternal) {
    return (
      <a href={destination} className={className} onClick={onClick} {...(props as React.AnchorHTMLAttributes<HTMLAnchorElement>)}>
        {children}
      </a>
    )
  }

  return (
    <RouterLink to={destination} className={className} onClick={onClick} {...(props as React.AnchorHTMLAttributes<HTMLAnchorElement>)}>
      {children}
    </RouterLink>
  )
}

export default Link

export function useRouter() {
  const navigate = useNavigate()
  return {
    push: useCallback((url: string) => navigate(url), [navigate]),
    replace: useCallback((url: string, _opts?: { scroll?: boolean }) => navigate(url, { replace: true }), [navigate]),
    back: useCallback(() => navigate(-1), [navigate]),
    forward: useCallback(() => navigate(1), [navigate]),
    refresh: useCallback(() => window.location.reload(), []),
  }
}

export function usePathname(): string {
  const location = useLocation()
  return location.pathname
}

export function useSearchParams(): URLSearchParams {
  const [searchParams] = useRRSearchParams()
  return searchParams
}

export function useParams<T extends Record<string, string | undefined> = Record<string, string | undefined>>(): T {
  return useRRParams() as T
}

export function redirect(url: string): never {
  window.location.href = url
  throw new Error(`Redirecting to ${url}`)
}

export function dynamic(
  loader: () => Promise<any>,
  options?: any
): React.ComponentType<any> {
  const LazyComponent = lazy(async () => {
    const mod = await loader()
    return 'default' in mod && mod.default ? mod : { default: mod }
  })

  const DynamicWrapper = (props: any) => (
    <Suspense fallback={options?.loading ? <options.loading /> : null}>
      <LazyComponent {...props} />
    </Suspense>
  )

  return DynamicWrapper as unknown as React.ComponentType<any>
}

export function Image({
  src,
  alt,
  width,
  height,
  className,
  style,
  ...props
}: {
  src: string
  alt: string
  width?: number | string
  height?: number | string
  className?: string
  style?: React.CSSProperties
  [key: string]: unknown
}) {
  return <img src={src} alt={alt} width={width} height={height} className={className} style={style} {...(props as React.ImgHTMLAttributes<HTMLImageElement>)} />
}
