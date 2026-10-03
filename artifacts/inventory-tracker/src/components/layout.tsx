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
    <div className="flex min-h-[100dvh] w-full flex-col bg-background md:flex-row">
      {/* Sidebar */}
      <aside className="w-full flex-shrink-0 border-b bg-card flex flex-col md:w-64 md:border-b-0 md:border-r">
        <div className="h-16 flex items-center px-6 border-b">
          <div className="flex items-center gap-2 text-primary font-bold text-lg tracking-tight">
            <img
              src={`${import.meta.env.BASE_URL}app-logo.webp`}
              alt="Top Speed Hobbies logo"
              width={40}
              height={40}
              className="h-10 w-10 shrink-0 rounded-lg object-contain"
            />
            <span className="text-base leading-tight">THS Inventory Sync</span>
          </div>
        </div>
        
        <nav className="flex flex-1 gap-1 overflow-x-auto p-2 md:block md:space-y-1 md:overflow-y-auto md:p-4">
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
        
        <div className="hidden p-4 border-t md:block">
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
        
        <div className={cn("flex-1 overflow-auto bg-background", location === "/" ? "p-0" : "p-4 md:p-8")}>
          <div className="max-w-7xl mx-auto space-y-8">
            {children}
          </div>
        </div>
      </main>
    </div>
  )
}
