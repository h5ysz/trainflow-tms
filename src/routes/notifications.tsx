"use client";

import { useI18n } from "@/lib/i18n/context";
import { PageHeader } from "@/components/common/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/common/empty-state";
import { useToast } from "@/hooks/use-toast";
import { Bell, CheckCheck, Info, CheckCircle2, AlertTriangle, XCircle, Clock, Check, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/lib/api/client";

interface Notification {
  id: string;
  title: string;
  message: string;
  type: string;
  category: string;
  link?: string | null;
  isRead: boolean;
  createdAt: string;
}

const TYPE_ICONS: Record<string, { icon: typeof Info; accent: string }> = {
  INFO: { icon: Info, accent: "bg-info/10 text-info" },
  SUCCESS: { icon: CheckCircle2, accent: "bg-success/10 text-success" },
  WARNING: { icon: AlertTriangle, accent: "bg-warning/10 text-warning" },
  ERROR: { icon: XCircle, accent: "bg-destructive/10 text-destructive" },
  REQUEST: { icon: Clock, accent: "bg-primary/10 text-primary" },
};

interface ListProps {
  notifications: Notification[];
  loading: boolean;
  busyId: string | null;
  onMarkRead: (n: Notification) => void;
  onDismiss: (n: Notification) => void;
}

function NotificationList({ notifications, loading, busyId, onMarkRead, onDismiss }: ListProps) {
  const { t } = useI18n();

  if (loading) {
    return <div className="p-8 text-center text-sm text-muted-foreground">{t("misc.loading")}</div>;
  }
  if (notifications.length === 0) {
    return (
      <EmptyState
        icon={Bell}
        title={t("notifications.empty.title")}
        subtitle={t("notifications.empty.subtitle")}
        className="py-12"
      />
    );
  }

  return (
    <div className="divide-y">
      {notifications.map((n) => {
        const cfg = TYPE_ICONS[n.type] ?? TYPE_ICONS.INFO;
        return (
          <div
            key={n.id}
            className={`group flex items-start gap-3 p-4 hover:bg-muted/30 ${!n.isRead ? "bg-primary/5" : ""}`}
          >
            <div className={`flex h-9 w-9 items-center justify-center rounded-full shrink-0 ${cfg.accent}`}>
              <cfg.icon className="h-4 w-4" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium flex items-center gap-2">
                {n.title}
                {!n.isRead && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">{n.message}</div>
              <div className="text-[10px] text-muted-foreground mt-1">
                {new Date(n.createdAt).toLocaleString()}
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {!n.isRead && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  title={t("notifications.markRead")}
                  disabled={busyId === n.id}
                  onClick={() => onMarkRead(n)}
                >
                  <Check className="h-3.5 w-3.5" />
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-destructive"
                title={t("notifications.dismiss")}
                disabled={busyId === n.id}
                onClick={() => onDismiss(n)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function NotificationsRoute() {
  const { t } = useI18n();
  const { toast } = useToast();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("all");
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async (filter?: string) => {
    setLoading(true);
    try {
      const res = await api.getList<Notification>("/notifications", {
        filter: filter === "unread" ? "unread" : undefined,
        pageSize: 50,
      });
      setNotifications(res.rows ?? []);
      setUnreadCount((res.pagination?.unreadCount as number) ?? 0);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load(tab === "unread" ? "unread" : undefined);
  }, [tab]);

  const reload = () => load(tab === "unread" ? "unread" : undefined);

  const markAllRead = async () => {
    try {
      await api.patch("/notifications", {});
      toast({ title: t("misc.success"), description: t("notifications.markAllRead") });
      void reload();
    } catch (e) {
      toast({ title: t("misc.error"), description: (e as Error).message, variant: "destructive" });
    }
  };

  const markRead = async (n: Notification) => {
    setBusyId(n.id);
    try {
      await api.patch(`/notifications/${n.id}`, { isRead: true });
      void reload();
    } catch (e) {
      toast({ title: t("misc.error"), description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  };

  const dismiss = async (n: Notification) => {
    setBusyId(n.id);
    try {
      await api.delete(`/notifications/${n.id}`);
      toast({ title: t("misc.success"), description: t("misc.deleteSuccess") });
      void reload();
    } catch (e) {
      toast({ title: t("misc.error"), description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  };

  const listProps = { notifications, loading, busyId, onMarkRead: markRead, onDismiss: dismiss };

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("notifications.title")}
        subtitle={t("notifications.subtitle")}
        icon={Bell}
        actions={
          <Button variant="outline" onClick={() => void markAllRead()} disabled={unreadCount === 0}>
            <CheckCheck className="h-4 w-4 me-1.5" />
            {t("notifications.markAllRead")}
          </Button>
        }
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="all">{t("notifications.filter.all")}</TabsTrigger>
          <TabsTrigger value="unread">
            {t("notifications.filter.unread")}
            {unreadCount > 0 && (
              <span className="ms-1.5 inline-flex items-center justify-center rounded-full bg-destructive text-destructive-foreground text-[10px] h-4 min-w-4 px-1">
                {unreadCount}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="mt-4">
          <Card><NotificationList {...listProps} /></Card>
        </TabsContent>

        <TabsContent value="unread" className="mt-4">
          <Card><NotificationList {...listProps} /></Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
