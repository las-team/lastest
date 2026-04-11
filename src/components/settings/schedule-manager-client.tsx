'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { CalendarClock, Play, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { createScheduleAction, deleteScheduleAction, getSchedulesAction, toggleScheduleAction, triggerScheduleNowAction } from '@/server/actions/schedules';
import { PRESET_SCHEDULES } from '@/lib/scheduling/cron';
import type { PresetScheduleKey } from '@/lib/scheduling/cron';

interface ScheduleWithDescription {
  id: string;
  repositoryId: string;
  name: string;
  cronExpression: string;
  cronDescription: string;
  enabled: boolean | null;
  timezone: string | null;
  runnerId: string | null;
  gitBranch: string | null;
  nextRunAt: Date | null;
  lastRunAt: Date | null;
  lastBuildId: string | null;
  consecutiveFailures: number | null;
  maxConsecutiveFailures: number | null;
}

export function ScheduleManagerCard({ repositoryId }: { repositoryId: string }) {
  const [schedules, setSchedules] = useState<ScheduleWithDescription[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDialog, setShowDialog] = useState(false);
  const [newName, setNewName] = useState('');
  const [selectedPreset, setSelectedPreset] = useState<PresetScheduleKey | 'custom'>('daily_3am');
  const [customCron, setCustomCron] = useState('');
  const [gitBranch, setGitBranch] = useState('');

  const loadSchedules = async () => {
    try {
      const data = await getSchedulesAction(repositoryId);
      setSchedules(data as ScheduleWithDescription[]);
    } catch {
      // Ignore load errors
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSchedules();
  }, [repositoryId]);

  const handleCreate = async () => {
    try {
      const cronExpression = selectedPreset === 'custom' ? customCron : PRESET_SCHEDULES[selectedPreset].cron;
      await createScheduleAction({
        repositoryId,
        name: newName || 'Scheduled Run',
        cronExpression,
        preset: selectedPreset !== 'custom' ? selectedPreset : undefined,
        gitBranch: gitBranch || undefined,
      });
      toast.success('Schedule created');
      setShowDialog(false);
      setNewName('');
      setCustomCron('');
      setGitBranch('');
      await loadSchedules();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to create schedule');
    }
  };

  const handleToggle = async (id: string, enabled: boolean) => {
    try {
      await toggleScheduleAction(id, repositoryId, enabled);
      await loadSchedules();
    } catch {
      toast.error('Failed to toggle schedule');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteScheduleAction(id, repositoryId);
      toast.success('Schedule deleted');
      await loadSchedules();
    } catch {
      toast.error('Failed to delete schedule');
    }
  };

  const handleTriggerNow = async (id: string) => {
    try {
      await triggerScheduleNowAction(id, repositoryId);
      toast.success('Build triggered');
      await loadSchedules();
    } catch {
      toast.error('Failed to trigger build');
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <CalendarClock className="h-5 w-5" />
              Scheduled Runs
            </CardTitle>
            <CardDescription>Configure recurring test runs on a schedule</CardDescription>
          </div>
          <Dialog open={showDialog} onOpenChange={setShowDialog}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="mr-1 h-4 w-4" />
                Add Schedule
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>New Scheduled Run</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label>Name</Label>
                  <Input
                    placeholder="e.g., Nightly Regression"
                    value={newName}
                    onChange={e => setNewName(e.target.value)}
                  />
                </div>
                <div>
                  <Label>Frequency</Label>
                  <Select value={selectedPreset} onValueChange={v => setSelectedPreset(v as PresetScheduleKey | 'custom')}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(PRESET_SCHEDULES).map(([key, preset]) => (
                        <SelectItem key={key} value={key}>{preset.label}</SelectItem>
                      ))}
                      <SelectItem value="custom">Custom cron expression</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {selectedPreset === 'custom' && (
                  <div>
                    <Label>Cron Expression</Label>
                    <Input
                      placeholder="0 3 * * *"
                      value={customCron}
                      onChange={e => setCustomCron(e.target.value)}
                      className="font-mono"
                    />
                    <p className="text-xs text-muted-foreground mt-1">Standard 5-field cron: minute hour day month weekday</p>
                  </div>
                )}
                <div>
                  <Label>Git Branch (optional)</Label>
                  <Input
                    placeholder="Leave empty for default branch"
                    value={gitBranch}
                    onChange={e => setGitBranch(e.target.value)}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowDialog(false)}>Cancel</Button>
                <Button onClick={handleCreate}>Create Schedule</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading schedules...</p>
        ) : schedules.length === 0 ? (
          <p className="text-sm text-muted-foreground">No scheduled runs configured. Add one to run tests automatically.</p>
        ) : (
          <div className="space-y-3">
            {schedules.map(schedule => (
              <div key={schedule.id} className="flex items-center justify-between rounded-md border p-3">
                <div className="flex items-center gap-3">
                  <Switch
                    checked={schedule.enabled ?? false}
                    onCheckedChange={checked => handleToggle(schedule.id, checked)}
                  />
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{schedule.name}</span>
                      <Badge variant="outline" className="text-xs font-mono">
                        {schedule.cronDescription}
                      </Badge>
                      {(schedule.consecutiveFailures ?? 0) > 0 && (
                        <Badge variant="destructive" className="text-xs">
                          {schedule.consecutiveFailures} failures
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {schedule.nextRunAt
                        ? `Next run: ${new Date(schedule.nextRunAt).toLocaleString()}`
                        : 'Not scheduled'}
                      {schedule.lastRunAt && (
                        <> · Last run: {new Date(schedule.lastRunAt).toLocaleString()}</>
                      )}
                      {schedule.gitBranch && (
                        <> · Branch: {schedule.gitBranch}</>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" onClick={() => handleTriggerNow(schedule.id)} title="Run now">
                    <Play className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => handleDelete(schedule.id)} title="Delete">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
