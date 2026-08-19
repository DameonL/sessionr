import React, { lazy, Suspense, useCallback } from 'react'
import {
  Link as RouterLink,
  useLocation,
  useNavigate,
  useParams as useRRParams,
  useSearchParams as useRRSearchParams,
} from 'react-router-dom'

/**
 * Next.js -> React Router Compatibility Adapter
 * Allows existing Next.js component imports (next/link, next/navigation, next/dynamic, next/image)
 * to work seamlessly in a Vite Single-Page Application (SPA).
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

export function dynamic<P = any>(
  loader: () => Promise<any>,
  options?: any
): React.ComponentType<P> {
  const LazyComponent = lazy(async () => {
    const mod = await loader()
    return 'default' in mod && mod.default ? mod : { default: mod }
  })

  return function DynamicWrapper(props: any) {
    return (
      <Suspense fallback={options?.loading ? <options.loading /> : null}>
        <LazyComponent {...props} />
      </Suspense>
    )
  } as unknown as React.ComponentType<P>
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
