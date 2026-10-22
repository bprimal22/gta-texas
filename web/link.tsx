import type { ComponentProps } from 'react';
/** The static build uses ordinary document navigation between its two pages. */
export default function Link({ children, ...props }: ComponentProps<'a'>) { return <a {...props}>{children}</a>; }
