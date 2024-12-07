export type CustomCssTarget = 'sidebar' | 'group'
export type CustomCssFieldName = 'sidebarCSS' | 'groupCSS'

export type CssVars = { [cssVarName: string]: string | null }

export type CustomStyles = { sidebarCSS?: string; groupCSS?: string }
