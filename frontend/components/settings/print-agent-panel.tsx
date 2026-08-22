"use client";

import { useState } from "react";
import { AlertTriangle, Copy, Plug, Plus, ShieldOff } from "lucide-react";
import { toast } from "sonner";

import {
  useEnrolPrintAgent,
  usePrintAgents,
  useRevokePrintAgent,
} from "@/lib/hooks/settings/use-print-agents";
import { printAgentLiveness, type EnrolledPrintAgent } from "@/lib/models/print-agent.model";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { formatUserFacingError } from "@/lib/errors";

const LIVENESS_COPY: Record<
  ReturnType<typeof printAgentLiveness>,
  { label: string; tone: string; detail: string }
> = {
  CONNECTED: {
    label: "Connected",
    tone: "border-success/40 bg-success/10 text-success dark:text-success",
    detail: "Polling for work now.",
  },
  STALE: {
    label: "Not responding",
    tone: "border-warning/40 bg-warning/10 text-warning dark:text-warning",
    detail: "It has polled before but not recently. The machine may be off or off the network.",
  },
  NEVER_STARTED: {
    label: "Never started",
    tone: "border-border bg-muted text-muted-foreground",
    detail: "Enrolled, but this agent has never polled. Start it with its credential.",
  },
  REVOKED: {
    label: "Revoked",
    tone: "border-destructive/40 bg-destructive/10 text-destructive",
    detail: "Its credential is refused. Kept for the record of what it printed.",
  },
};

/**
 * The machines allowed to drive this branch's printers.
 *
 * <h2>Why "Connected" is computed and not stored</h2>
 *
 * <p>There is no connected flag on the server and there must not be one. The server stamps
 * `lastSeenAt` every time an agent polls for work; this panel reads recency. A stored boolean
 * would say CONNECTED for ever about a machine unplugged in March, which is the class of comforting
 * lie this whole repair exists to remove.
 */
export function PrintAgentPanel({ branchId }: { branchId: string | null }) {
  const agents = usePrintAgents(branchId);
  const enrol = useEnrolPrintAgent(branchId);
  const revoke = useRevokePrintAgent(branchId);

  /**
   * ONE dialog, two phases — not two dialogs.
   *
   * <p>The first draft used a separate `Dialog` for the form and another for the credential, and
   * enrolling closed the first while opening the second. Radix guards focus when a modal unmounts,
   * and a modal mounted inside that window is intermittently dismissed on arrival: the credential
   * dialog appeared and vanished, reproducibly-but-not-always, in a Chromium journey. That is not a
   * cosmetic race. <b>The credential cannot be reissued</b> — losing it costs a re-enrolment and,
   * on a real install, a trip back to the restaurant. One dialog that changes what it contains
   * cannot lose the race because there is no race.
   */
  const [dialog, setDialog] = useState<
    { phase: "closed" } | { phase: "form" } | { phase: "secret"; issued: EnrolledPrintAgent }
  >({ phase: "closed" });
  const [label, setLabel] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);

  async function handleEnrol() {
    try {
      const result = await enrol.mutateAsync({ label: label.trim() || undefined });
      setAcknowledged(false);
      setDialog({ phase: "secret", issued: result });
      setLabel("");
    } catch (error) {
      toast.error(`Could not enrol the print agent — ${formatUserFacingError(error)}`);
    }
  }

  async function handleRevoke(agentId: string, agentLabel: string) {
    try {
      await revoke.mutateAsync(agentId);
      toast.success(`${agentLabel} revoked. It will stop collecting jobs on its next poll.`);
    } catch (error) {
      toast.error(`Could not revoke the print agent — ${formatUserFacingError(error)}`);
    }
  }

  const list = agents.data ?? [];

  return (
    <Card depth={2}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Plug className="size-4" aria-hidden="true" />
          Print agents
        </CardTitle>
        <CardDescription>
          A print agent is a small program running on a machine in this branch. It is the only thing
          that can put bytes on a printer — a browser cannot open a socket to port 9100 or address a
          USB spooler. It collects jobs from the server, so it keeps printing kitchen tickets when
          no browser tab is open anywhere.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex justify-end">
          <Button
            size="sm"
            onClick={() => setDialog({ phase: "form" })}
            disabled={!branchId}
            data-testid="enrol-agent-button"
          >
            <Plus className="size-4" aria-hidden="true" />
            Enrol an agent
          </Button>
        </div>

        <QueryBoundary
          query={agents}
          what="this branch's print agents"
          moduleLabel="Printing"
          empty={
            <EmptyState
              icon={Plug}
              title="No print agent is enrolled"
              description="Nothing on this branch can drive a printer yet. Enrol an agent, then run it on the machine the printers are attached to."
            />
          }
          isEmpty={list.length === 0}
        >
          <ul className="divide-y rounded-lg border" data-testid="print-agent-list">
            {list.map((agent) => {
              const liveness = printAgentLiveness(agent);
              const copy = LIVENESS_COPY[liveness];
              return (
                <li
                  key={agent.agentId}
                  className="flex flex-wrap items-center justify-between gap-3 p-3"
                  data-testid="print-agent-row"
                  data-agent-liveness={liveness}
                >
                  <div className="min-w-0">
                    <p className="truncate text-small font-medium">{agent.label}</p>
                    <p className="text-label text-muted-foreground">{copy.detail}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-label font-medium ${copy.tone}`}
                    >
                      {copy.label}
                    </span>
                    {agent.revokedAt === null && (
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => void handleRevoke(agent.agentId, agent.label)}
                        disabled={revoke.isPending}
                      >
                        <ShieldOff className="size-3.5" aria-hidden="true" />
                        Revoke
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </QueryBoundary>
      </CardContent>

      {/*
        `onOpenChange` never closes the SECRET phase from outside — no backdrop click, no Escape.
        The value cannot be recovered, and a dialog that vanishes when the mouse slips costs a
        re-enrolment. The only way out of that phase is the button, and the button is disabled
        until the checkbox is ticked.
      */}
      <Dialog
        open={dialog.phase !== "closed"}
        onOpenChange={(open) => {
          if (!open && dialog.phase === "form") setDialog({ phase: "closed" });
        }}
      >
        {dialog.phase === "form" && (
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Enrol a print agent</DialogTitle>
              <DialogDescription>
                Give the machine a name you will recognise on this list — &ldquo;Back office
                PC&rdquo;, &ldquo;Counter till&rdquo;. You will be shown a credential once, and only
                once.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="agent-label">Name</Label>
              <Input
                id="agent-label"
                value={label}
                placeholder="Back office PC"
                onChange={(e) => setLabel(e.target.value)}
                maxLength={120}
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialog({ phase: "closed" })}>
                Cancel
              </Button>
              <Button onClick={() => void handleEnrol()} disabled={enrol.isPending}>
                {enrol.isPending ? "Enrolling…" : "Enrol"}
              </Button>
            </DialogFooter>
          </DialogContent>
        )}

        {dialog.phase === "secret" && (
          <DialogContent showCloseButton={false} data-testid="agent-secret-dialog">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <AlertTriangle className="size-4 text-warning" aria-hidden="true" />
                Copy this credential now — it is shown once
              </DialogTitle>
              <DialogDescription>
                This is the only time this value will ever exist outside the machine you paste it
                into. It is stored hashed, it is not in any log, and no screen can show it again. If
                you lose it, revoke this agent and enrol another one.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="agent-secret">Credential</Label>
                <div className="flex gap-2">
                  <Input
                    id="agent-secret"
                    readOnly
                    value={dialog.issued.secret}
                    data-testid="agent-secret-value"
                    className="font-mono text-label"
                  />
                  <Button
                    variant="outline"
                    onClick={() => {
                      void navigator.clipboard?.writeText(dialog.issued.secret);
                      toast.success("Credential copied");
                    }}
                  >
                    <Copy className="size-4" aria-hidden="true" />
                    Copy
                  </Button>
                </div>
              </div>

              <div className="rounded-lg border bg-muted/40 p-3">
                <p className="text-label font-medium">Start the agent on that machine with:</p>
                <pre className="relative mt-1 overflow-x-auto text-[11px] leading-relaxed text-muted-foreground">
                  {`PRINT_AGENT_CLOUD_URL=<gateway url> \\
PRINT_AGENT_CREDENTIAL=<the credential above> \\
node print-agent/dist/main.js`}
                </pre>
                <p className="mt-2 text-label text-muted-foreground">
                  It will appear above as <strong>Connected</strong> within a few seconds, and it
                  learns which printers to drive from this page — you do not configure them twice.
                </p>
              </div>

              <label className="flex items-start gap-2 text-small">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={acknowledged}
                  data-testid="agent-secret-ack"
                  onChange={(e) => setAcknowledged(e.target.checked)}
                />
                <span>I have copied the credential. I understand it cannot be shown again.</span>
              </label>
            </div>

            <DialogFooter>
              <Button
                disabled={!acknowledged}
                data-testid="agent-secret-done"
                onClick={() => setDialog({ phase: "closed" })}
              >
                Done
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </Card>
  );
}
