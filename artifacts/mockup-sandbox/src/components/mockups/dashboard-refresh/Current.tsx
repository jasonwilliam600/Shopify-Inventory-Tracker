import { useGetDashboard, useListActivity, useHealthCheck } from "./_data"
import "./_group.css"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "./_cards"
import { AlertCircle, ArrowUpRight, Box, CheckCircle2, Clock, RefreshCw, ShoppingCart, Store } from "lucide-react"
import type { ReactNode } from "react"
function Link({children}: {href: string; children: ReactNode}) { return <div>{children}</div> }
import { formatDistanceToNow } from "date-fns"

export default function Dashboard() {
  const { data: dashboard, isLoading: dashLoading } = useGetDashboard()
  const { data: activities, isLoading: actLoading } = useListActivity()
  const { data: health, isLoading: healthLoading } = useHealthCheck()

  if (dashLoading || actLoading || healthLoading) {
    return <div className="flex items-center justify-center h-64 text-muted-foreground animate-pulse">Loading dashboard...</div>
  }

  if (!dashboard) {
    return <div className="text-destructive font-mono text-sm border border-destructive p-4 rounded bg-destructive/10">Failed to load dashboard data</div>
  }

  const kpis = [
    { title: "Total SKUs", value: dashboard.totalSkus, icon: Box, color: "text-blue-500", desc: "Monitored items" },
    { title: "Ready to Sell", value: dashboard.readyToSell, icon: CheckCircle2, color: "text-success", desc: "Available stock" },
    { title: "Mismatches", value: dashboard.mismatches, icon: AlertCircle, color: "text-warning", desc: "Action required" },
    { title: "Low Stock", value: dashboard.lowStock, icon: ShoppingCart, color: "text-blue-400", desc: "Almost depleted" },
  ]

  return (
    <div className="min-h-screen bg-background p-6 text-foreground font-sans"><div className="space-y-6">
      {/* Header and Connection Status */}
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">Overview</h2>
          <p className="text-muted-foreground text-sm">Real-time inventory sync operations.</p>
        </div>
        
        <div className="flex gap-4">
          <Card className="flex items-center gap-3 py-2 px-4 shadow-sm border-primary/20 bg-card/50">
            <Store className="w-5 h-5 text-primary" />
            <div className="flex flex-col">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Shopify Status</span>
              <div className="flex items-center gap-2">
                {dashboard.shopifyConnected ? (
                  <>
                    <span className="text-sm font-semibold">{dashboard.shopifyStoreName || "Connected"}</span>
                    <span className="w-2 h-2 rounded-full bg-success relative">
                      <span className="absolute inset-0 rounded-full bg-success animate-ping opacity-75"></span>
                    </span>
                  </>
                ) : (
                  <>
                    <span className="text-sm font-semibold text-muted-foreground">Disconnected</span>
                    <span className="w-2 h-2 rounded-full bg-destructive"></span>
                  </>
                )}
              </div>
            </div>
          </Card>
          
          <Card className="flex items-center gap-3 py-2 px-4 shadow-sm border-primary/20 bg-card/50">
            <RefreshCw className="w-5 h-5 text-primary" />
            <div className="flex flex-col">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">System Health</span>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold">{health?.status === 'ok' ? 'Operational' : 'Degraded'}</span>
                <span className={`w-2 h-2 rounded-full ${health?.status === 'ok' ? 'bg-success' : 'bg-warning'}`}></span>
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* KPI Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {kpis.map((kpi, i) => (
          <Card key={i} className="hover-elevate transition-shadow border-l-4 border-l-transparent data-[alert=true]:border-l-warning" data-alert={kpi.title === 'Mismatches' && kpi.value > 0}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{kpi.title}</CardTitle>
              <kpi.icon className={`h-5 w-5 ${kpi.color}`} />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold font-mono tracking-tight">{kpi.value}</div>
              <p className="text-xs text-muted-foreground mt-1">{kpi.desc}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {/* Action Required Panel */}
        <Card className="md:col-span-2 border-warning/30 bg-warning/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-warning">
              <AlertCircle className="w-5 h-5" />
              Action Required
            </CardTitle>
            <CardDescription>
              Inventory items that need manual review before syncing.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {dashboard.pendingReview > 0 ? (
              <div className="flex items-center justify-between p-4 bg-background border border-warning/20 rounded-lg">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-full bg-warning/20 flex items-center justify-center text-warning font-bold text-lg">
                    {dashboard.pendingReview}
                  </div>
                  <div>
                    <h4 className="font-semibold">Pending Reviews</h4>
                    <p className="text-sm text-muted-foreground">Supplier stock doesn't match Shopify.</p>
                  </div>
                </div>
                <Link href="/inventory?status=pending">
                  <div className="flex items-center gap-2 text-sm font-medium bg-warning text-warning-foreground px-4 py-2 rounded-md hover:bg-warning/90 transition-colors cursor-pointer">
                    Review Now
                    <ArrowUpRight className="w-4 h-4" />
                  </div>
                </Link>
              </div>
            ) : (
              <div className="flex items-center justify-center h-32 border-2 border-dashed border-success/20 rounded-lg bg-success/5 text-success">
                <div className="flex flex-col items-center gap-2">
                  <CheckCircle2 className="w-8 h-8" />
                  <span className="font-medium">All items synchronized</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Activity */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Recent Activity</CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            <div className="flex flex-col divide-y">
              {activities && activities.length > 0 ? (
                activities.slice(0, 5).map((activity) => (
                  <div key={activity.id} className="p-4 flex gap-4 hover:bg-muted/50 transition-colors">
                    <div className="w-8 h-8 rounded bg-primary/10 flex items-center justify-center text-primary shrink-0 mt-0.5">
                      <Clock className="w-4 h-4" />
                    </div>
                    <div className="flex flex-col gap-1 min-w-0">
                      <span className="text-sm font-medium leading-none truncate">{activity.title}</span>
                      <span className="text-xs text-muted-foreground line-clamp-2">{activity.description}</span>
                      <span className="text-xs font-mono text-muted-foreground mt-1">
                        {formatDistanceToNow(new Date(activity.createdAt), { addSuffix: true })}
                      </span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="p-8 text-center text-sm text-muted-foreground">No recent activity</div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div></div>
  )
}
