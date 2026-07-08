"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { PageHeader } from "@/components/common/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/common/empty-state";
import { Bell, CheckCheck, Info, CheckCircle2, AlertTriangle, XCircle, Clock } from "lucide-react";

const TYPE_ICONS = {
  INFO: { icon: Info, accent: "bg-info/10 text-info" },
  SUCCESS: { icon: CheckCircle2, accent: "bg-success/10 text-success" },
  WARNING: { icon: AlertTriangle, accent: "bg-warning/10 text-warning" },
  ERROR: { icon: XCircle, accent: "bg-destructive/10 text-destructive" },
  REQUEST: { icon: Clock, accent: "bg-primary/10 text-primary" },
} as const;

export function NotificationsRoute() {
  const { t } = useI18n();
  const notifications: any[] = [];

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("notifications.title")}
        subtitle={t("notifications.subtitle")}
        icon={Bell}
        actions={<Button variant="outline"><CheckCheck className="h-4 w-4 me-1.5" />{t("notifications.markAllRead")}</Button>}
      />

      <Tabs defaultValue="all">
        <TabsList>
          <TabsTrigger value="all">{t("notifications.filter.all")}</TabsTrigger>
          <TabsTrigger value="unread">{t("notifications.filter.unread")}</TabsTrigger>
        </TabsList>
        <TabsContent value="all" className="mt-4">
          <Card>
            {notifications.length === 0 ? (
              <EmptyState
                icon={Bell}
                title={t("notifications.empty.title")}
                subtitle={t("notifications.empty.subtitle")}
                className="py-12"
              />
            ) : (
              <div className="divide-y">
                {notifications.map((n) => {
                  const cfg = TYPE_ICONS[n.type as keyof typeof TYPE_ICONS] ?? TYPE_ICONS.INFO;
                  return (
                    <div key={n.id} className="flex items-start gap-3 p-4 hover:bg-muted/30">
                      <div className={`flex h-9 w-9 items-center justify-center rounded-full shrink-0 ${cfg.accent}`}>
                        <cfg.icon className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium">{n.title}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">{n.message}</div>
                        <div className="text-[10px] text-muted-foreground mt-1">{n.createdAt}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </TabsContent>
        <TabsContent value="unread" className="mt-4">
          <Card>
            <EmptyState
              icon={Bell}
              title={t("notifications.empty.title")}
              subtitle={t("notifications.empty.subtitle")}
              className="py-12"
            />
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
