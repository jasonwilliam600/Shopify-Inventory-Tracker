import { Link, useLocation } from "wouter"
import { PackageSearch, LayoutDashboard, FileSpreadsheet, GitBranch, ClipboardCheck, ArrowRightLeft } from "lucide-react"
import { cn } from "@/lib/utils"
import { ThemeSelector } from "@/components/theme-selector"
import { AccountMenu } from "@/components/account-menu"
import { useTheme } from "next-themes"

interface LayoutProps {
  children: React.ReactNode
}

export function Layout({ children }: LayoutProps) {
  const [location] = useLocation()
  const { resolvedTheme } = useTheme()

  const navItems = [
    { href: "/", label: "Dashboard", icon: LayoutDashboard },
    { href: "/inventory", label: "Inventory", icon: PackageSearch },
    { href: "/suppliers", label: "Suppliers", icon: FileSpreadsheet },
    { href: "/sku-mappings", label: "SKU Mapping Manager", icon: GitBranch },
    { href: "/sku-mapping-center", label: "SKU Mapping Center", icon: ArrowRightLeft },
    { href: "/matrixify", label: "Matrixify Review", icon: ClipboardCheck },
  ]

  return (
    <div className="app-shell flex min-h-[100dvh] w-full flex-col bg-background md:flex-row">
      {/* Sidebar */}
      <aside className="app-sidebar flex w-full flex-shrink-0 flex-col border-b bg-card md:w-[232px] md:border-b-0 md:border-r">
        <div className="app-brand h-[72px] flex items-center px-5 border-b">
          <Link href="/" className="brand-link" aria-label="TSH Inventory Sync home">
            <img src={`${import.meta.env.BASE_URL}${resolvedTheme === "dark" ? "tsh-brand-dark.svg" : "tsh-brand.svg"}`} alt="TSH Inventory Sync" width="185" height="49" />
          </Link>
        </div>
        
        <nav aria-label="Main navigation" className="app-nav flex flex-1 gap-1 overflow-x-auto p-2 md:block md:space-y-1 md:overflow-y-auto md:p-3">
          {navItems.map((item) => {
            const isActive = location === item.href
            return (
              <Link key={item.href} href={item.href}>
                <div
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "nav-item flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-semibold transition-colors cursor-pointer",
                    isActive
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  <item.icon className="w-4 h-4" />
                  {item.label}
                </div>
              </Link>
            )
          })}
        </nav>
        
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="app-header min-h-[64px] flex items-center gap-3 px-4 py-3 md:px-7 border-b bg-card justify-between shrink-0">
          <h1 className="app-page-title min-w-0 text-base md:text-lg font-semibold text-foreground">
            {navItems.find(i => i.href === location)?.label || "Page"}
          </h1>
          
          <div className="flex shrink-0 items-center gap-2 md:gap-3">
            <ThemeSelector />
            <AccountMenu />
          </div>
        </header>
        
        <div className={cn("app-content flex-1 overflow-auto bg-background", location === "/" ? "p-0" : "p-4 md:p-7")}>
          <div className="max-w-7xl mx-auto space-y-8">
            {children}
          </div>
        </div>
      </main>
    </div>
  )
}
