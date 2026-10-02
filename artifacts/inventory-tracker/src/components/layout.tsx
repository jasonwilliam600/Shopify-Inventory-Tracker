import { Link, useLocation } from "wouter"
import { PackageSearch, LayoutDashboard, FileSpreadsheet, Settings } from "lucide-react"
import { cn } from "@/lib/utils"

interface LayoutProps {
  children: React.ReactNode
}

export function Layout({ children }: LayoutProps) {
  const [location] = useLocation()

  const navItems = [
    { href: "/", label: "Dashboard", icon: LayoutDashboard },
    { href: "/inventory", label: "Inventory", icon: PackageSearch },
    { href: "/suppliers", label: "Suppliers", icon: FileSpreadsheet },
  ]

  return (
    <div className="flex min-h-[100dvh] w-full bg-background">
      {/* Sidebar */}
      <aside className="w-64 flex-shrink-0 border-r bg-card flex flex-col">
        <div className="h-16 flex items-center px-6 border-b">
          <div className="flex items-center gap-2 text-primary font-bold text-lg tracking-tight">
            <div className="w-8 h-8 rounded bg-primary flex items-center justify-center text-primary-foreground">
              <PackageSearch className="w-5 h-5" />
            </div>
            OPS_CONTROL
          </div>
        </div>
        
        <nav className="flex-1 overflow-y-auto p-4 space-y-1">
          {navItems.map((item) => {
            const isActive = location === item.href
            return (
              <Link key={item.href} href={item.href}>
                <div
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors cursor-pointer",
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
        
        <div className="p-4 border-t">
          <div className="flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium text-muted-foreground hover:bg-muted cursor-pointer">
            <Settings className="w-4 h-4" />
            Settings
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="h-16 flex items-center px-8 border-b bg-card justify-between shrink-0">
          <h1 className="text-xl font-semibold text-foreground">
            {navItems.find(i => i.href === location)?.label || "Page"}
          </h1>
          
          <div className="flex items-center gap-4">
            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold text-xs border border-primary/20">
              SM
            </div>
          </div>
        </header>
        
        <div className="flex-1 overflow-auto p-8 bg-background">
          <div className="max-w-7xl mx-auto space-y-8">
            {children}
          </div>
        </div>
      </main>
    </div>
  )
}
