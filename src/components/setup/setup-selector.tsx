'use client';

import { useState } from 'react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { ChevronDown, Code, FileCode, X, Search } from 'lucide-react';
import type { Test, SetupScript } from '@/lib/db/schema';

export type SetupSelection =
  | { type: 'none' }
  | { type: 'test'; id: string; name: string }
  | { type: 'script'; id: string; name: string };

interface SetupSelectorProps {
  value: SetupSelection;
  onChange: (selection: SetupSelection) => void;
  availableTests: Test[];
  availableScripts: SetupScript[];
  excludeTestId?: string;
  disabled?: boolean;
  showInherited?: boolean;
}

export function SetupSelector({
  value,
  onChange,
  availableTests,
  availableScripts,
  excludeTestId,
  disabled = false,
  showInherited = false,
}: SetupSelectorProps) {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'test' | 'script'>(
    value.type === 'script' ? 'script' : 'test'
  );

  // Filter tests (exclude self-reference)
  const filteredTests = availableTests
    .filter((t) => t.id !== excludeTestId)
    .filter((t) =>
      searchQuery
        ? t.name.toLowerCase().includes(searchQuery.toLowerCase())
        : true
    );

  // Filter scripts
  const filteredScripts = availableScripts.filter((s) =>
    searchQuery
      ? s.name.toLowerCase().includes(searchQuery.toLowerCase())
      : true
  );

  const handleSelect = (selection: SetupSelection) => {
    onChange(selection);
    setOpen(false);
    setSearchQuery('');
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange({ type: 'none' });
  };

  const getDisplayValue = () => {
    if (value.type === 'none') {
      return showInherited ? 'Inherited from repository' : 'None';
    }
    return value.name;
  };

  const getIcon = () => {
    if (value.type === 'test') {
      return <FileCode className="h-4 w-4 text-blue-500" />;
    }
    if (value.type === 'script') {
      return <Code className="h-4 w-4 text-green-500" />;
    }
    return null;
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className="w-full justify-between"
          disabled={disabled}
        >
          <div className="flex items-center gap-2 min-w-0">
            {getIcon()}
            <span className="truncate">{getDisplayValue()}</span>
            {value.type !== 'none' && (
              <Badge variant="secondary" className="shrink-0">
                {value.type}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {value.type !== 'none' && (
              <X
                className="h-4 w-4 hover:text-destructive cursor-pointer"
                onClick={handleClear}
              />
            )}
            <ChevronDown className="h-4 w-4 opacity-50" />
          </div>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <div className="p-3 border-b">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8"
            />
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'test' | 'script')}>
          <TabsList className="w-full rounded-none border-b">
            <TabsTrigger value="test" className="flex-1">
              Use Test ({filteredTests.length})
            </TabsTrigger>
            <TabsTrigger value="script" className="flex-1">
              Use Script ({filteredScripts.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="test" className="m-0">
            <div className="max-h-60 overflow-y-auto">
              <button
                className="w-full px-3 py-2 text-left text-sm hover:bg-muted transition-colors flex items-center gap-2"
                onClick={() => handleSelect({ type: 'none' })}
              >
                <span className="text-muted-foreground">None</span>
              </button>
              {filteredTests.length === 0 ? (
                <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                  No tests found
                </div>
              ) : (
                filteredTests.map((test) => (
                  <button
                    key={test.id}
                    className={`w-full px-3 py-2 text-left text-sm hover:bg-muted transition-colors flex items-center gap-2 ${
                      value.type === 'test' && value.id === test.id
                        ? 'bg-muted'
                        : ''
                    }`}
                    onClick={() =>
                      handleSelect({ type: 'test', id: test.id, name: test.name })
                    }
                  >
                    <FileCode className="h-4 w-4 text-blue-500 shrink-0" />
                    <span className="truncate">{test.name}</span>
                  </button>
                ))
              )}
            </div>
          </TabsContent>

          <TabsContent value="script" className="m-0">
            <div className="max-h-60 overflow-y-auto">
              <button
                className="w-full px-3 py-2 text-left text-sm hover:bg-muted transition-colors flex items-center gap-2"
                onClick={() => handleSelect({ type: 'none' })}
              >
                <span className="text-muted-foreground">None</span>
              </button>
              {filteredScripts.length === 0 ? (
                <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                  No scripts found
                </div>
              ) : (
                filteredScripts.map((script) => (
                  <button
                    key={script.id}
                    className={`w-full px-3 py-2 text-left text-sm hover:bg-muted transition-colors flex items-center gap-2 ${
                      value.type === 'script' && value.id === script.id
                        ? 'bg-muted'
                        : ''
                    }`}
                    onClick={() =>
                      handleSelect({ type: 'script', id: script.id, name: script.name })
                    }
                  >
                    <Code className="h-4 w-4 text-green-500 shrink-0" />
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="truncate">{script.name}</span>
                      <Badge variant="outline" className="shrink-0 text-xs">
                        {script.type}
                      </Badge>
                    </div>
                  </button>
                ))
              )}
            </div>
          </TabsContent>
        </Tabs>
      </PopoverContent>
    </Popover>
  );
}
