"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  createShiftTemplateAction,
  setShiftTemplateActiveAction,
  updateShiftTemplateAction,
} from "@/actions/shift-template.actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { formatTime12h } from "@/lib/format-time";

interface ShiftTemplateRow {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  active: boolean;
}

interface ShiftTemplateSettingsProps {
  templates: ShiftTemplateRow[];
}

// Owner request (2026-08-11): "create a setting for time schedule as
// well" — up to now Opening/Closing only existed via a one-off seed
// script, with no way to add a third shift or fix a typo'd time
// without another one-off. Edit-in-place per row, same idiom as the
// Schedule page's own "Custom hours…" cell, plus a plain add-new-shift
// form. Deactivate only — ShiftTemplate has no delete method, same
// "deactivate, never delete" policy as Employee (see
// shift-template.service.ts's own comment).
export function ShiftTemplateSettings({ templates }: ShiftTemplateSettingsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editStart, setEditStart] = useState("");
  const [editEnd, setEditEnd] = useState("");

  const [newName, setNewName] = useState("");
  const [newStart, setNewStart] = useState("07:00");
  const [newEnd, setNewEnd] = useState("15:00");

  function startEdit(template: ShiftTemplateRow) {
    setEditingId(template.id);
    setEditName(template.name);
    setEditStart(template.startTime);
    setEditEnd(template.endTime);
  }

  function handleSaveEdit(templateId: string) {
    startTransition(async () => {
      const result = await updateShiftTemplateAction({
        templateId,
        name: editName,
        startTime: editStart,
        endTime: editEnd,
      });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Shift updated.");
      setEditingId(null);
      router.refresh();
    });
  }

  function handleToggleActive(template: ShiftTemplateRow, active: boolean) {
    startTransition(async () => {
      const result = await setShiftTemplateActiveAction({ templateId: template.id, active });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(active ? `${template.name} reactivated.` : `${template.name} deactivated.`);
      router.refresh();
    });
  }

  function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      const result = await createShiftTemplateAction({
        name: newName,
        startTime: newStart,
        endTime: newEnd,
      });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Shift created.");
      setNewName("");
      setNewStart("07:00");
      setNewEnd("15:00");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardContent className="overflow-x-auto p-0">
          {templates.length === 0 ? (
            <p className="text-muted-foreground p-4 text-sm">No shifts yet — add one below.</p>
          ) : (
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-muted/40">
                  <th className="text-muted-foreground border-b px-3 py-2 text-left text-xs font-medium">
                    Name
                  </th>
                  <th className="text-muted-foreground border-b px-3 py-2 text-left text-xs font-medium">
                    Start
                  </th>
                  <th className="text-muted-foreground border-b px-3 py-2 text-left text-xs font-medium">
                    End
                  </th>
                  <th className="text-muted-foreground border-b px-3 py-2 text-left text-xs font-medium">
                    Active
                  </th>
                  <th className="border-b px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {templates.map((template) => {
                  const isEditing = editingId === template.id;
                  return (
                    <tr key={template.id} className="border-t">
                      {isEditing ? (
                        <>
                          <td className="px-3 py-2">
                            <Input
                              value={editName}
                              onChange={(event) => setEditName(event.target.value)}
                              className="h-8 w-40"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <Input
                              type="time"
                              value={editStart}
                              onChange={(event) => setEditStart(event.target.value)}
                              className="h-8 w-28"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <Input
                              type="time"
                              value={editEnd}
                              onChange={(event) => setEditEnd(event.target.value)}
                              className="h-8 w-28"
                            />
                          </td>
                          <td className="px-3 py-2 text-muted-foreground text-xs">
                            {template.active ? "Active" : "Inactive"}
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex justify-end gap-2">
                              <Button
                                type="button"
                                size="sm"
                                disabled={isPending}
                                onClick={() => handleSaveEdit(template.id)}
                              >
                                Save
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                disabled={isPending}
                                onClick={() => setEditingId(null)}
                              >
                                Cancel
                              </Button>
                            </div>
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="px-3 py-2 font-medium">{template.name}</td>
                          <td className="px-3 py-2">{formatTime12h(template.startTime)}</td>
                          <td className="px-3 py-2">{formatTime12h(template.endTime)}</td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2">
                              <Switch
                                checked={template.active}
                                onCheckedChange={(checked) => handleToggleActive(template, checked)}
                                disabled={isPending}
                                tone="status"
                                aria-label={`${template.name} active`}
                              />
                              <span className="text-muted-foreground text-xs">
                                {template.active ? "Active" : "Inactive"}
                              </span>
                            </div>
                          </td>
                          <td className="px-3 py-2 text-right">
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              disabled={isPending}
                              onClick={() => startEdit(template)}
                            >
                              Edit
                            </Button>
                          </td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add a shift</CardTitle>
        </CardHeader>
        <form onSubmit={handleCreate}>
          <CardContent className="flex flex-col gap-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="newShiftName">Name</Label>
                <Input
                  id="newShiftName"
                  value={newName}
                  onChange={(event) => setNewName(event.target.value)}
                  placeholder="e.g. Mid shift"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="newShiftStart">Start</Label>
                <Input
                  id="newShiftStart"
                  type="time"
                  value={newStart}
                  onChange={(event) => setNewStart(event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="newShiftEnd">End</Label>
                <Input
                  id="newShiftEnd"
                  type="time"
                  value={newEnd}
                  onChange={(event) => setNewEnd(event.target.value)}
                />
              </div>
              <div className="flex items-end">
                <Button type="submit" disabled={isPending || !newName.trim()} className="w-full">
                  {isPending ? "Adding…" : "Add shift"}
                </Button>
              </div>
            </div>
          </CardContent>
        </form>
      </Card>
    </div>
  );
}
