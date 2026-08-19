declare module 'next/link' {
  import React from 'react'
  export interface LinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
    href?: string
    to?: string
    prefetch?: boolean
  }
  export const Link: React.ComponentType<LinkProps>
  export default Link
}

declare module 'next/navigation' {
  export function useRouter(): {
    push(url: string): void
    replace(url: string, opts?: { scroll?: boolean }): void
    back(): void
    forward(): void
    refresh(): void
  }
  export function usePathname(): string
  export function useSearchParams(): URLSearchParams
  export function useParams<T extends Record<string, string | undefined> = Record<string, string | undefined>>(): T
  export function redirect(url: string): never
}

declare module 'next/dynamic' {
  import React from 'react'
  export default function dynamic<P = any>(
    loader: () => Promise<React.ComponentType<P> | { default: React.ComponentType<P> } | any>,
    options?: { ssr?: boolean; loading?: () => React.ReactNode }
  ): React.ComponentType<P>
}

declare module 'next/image' {
  import React from 'react'
  export const Image: React.ComponentType<React.ImgHTMLAttributes<HTMLImageElement>>
  export default Image
}
