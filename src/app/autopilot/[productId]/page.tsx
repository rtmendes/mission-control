'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Rocket, Play, Layers, Lightbulb, BarChart3, FileText, Zap, Loader, Settings, X, Save, ExternalLink } from 'lucide-react';
import { SwipeDeck } from '@/components/autopilot/SwipeDeck';
import { IdeasList } from '@/components/autopilot/IdeasList';
import { ResearchReport } from '@/components/autopilot/ResearchReport';
import { BuildQueue } from '@/components/autopilot/BuildQueue';
import { ProductProgramEditor } from '@/components/autopilot/ProductProgramEditor';
import { MaybePool } from '@/components/autopilot/MaybePool';
import { CostDashboard } from '@/components/costs/CostDashboard';
import { ActivityPanel } from '@/components/autopilot/ActivityPanel';
import type { Product } from '@/lib/types';

type Tab = 'swipe' | 'ideas' | 'research' | 'build' | 'costs' | 'program' | 'maybe';
type PipelineState = 'idle' | 'researching' | 'ideating' | 'done' | 'error';

export default function ProductDashboardPage() {
  const { productId } = useParams<{ productId: string }>();
  const [product, setProduct] = useState<Product | null>(null);
  const [tab, setTab] = useState<Tab>('swipe');
  const [loading, setLoading] = useState(true);
  const [pipeline, setPipeline] = useState<PipelineState>('idle');
  const [pipelineError, setPipelineError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsForm, setSettingsForm] = useState<Record<string, string>>({});
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/products/${productId}`);
        if (res.ok) setProduct(await res.json());
      } catch (error) {
        console.error('Failed to load product:', error);
      } finally {
        setLoading(false);
      }
    })();
  }, [productId]);

  const runNow = useCallback(async () => {
    if (pipeline !== 'idle') return;
    setPipeline('researching');
    setPipelineError(null);

    try {
      // Step 1: Research
      const researchRes = await fetch(`/api/products/${productId}/research/run`, { method: 'POST' });
      if (!researchRes.ok) {
        const err = await researchRes.json().catch(() => ({ error: 'Research failed' }));
        throw new Error(err.error || `Research failed (${researchRes.status})`);
      }
      const { cycle_id } = await researchRes.json();

      // Poll until research completes (check every 5s, max 10 min)
      const maxWait = 600000;
      const start = Date.now();
      let researchDone = false;
      while (Date.now() - start < maxWait) {
        await new Promise(r => setTimeout(r, 5000));
        const statusRes = await fetch(`/api/products/${productId}/research/cycles`);
        if (statusRes.ok) {
          const cycles = await statusRes.json();
          const cycle = cycles.find((c: { id: string }) => c.id === cycle_id);
          if (cycle?.status === 'completed') { researchDone = true; break; }
          if (cycle?.status === 'failed') throw new Error(cycle.error_message || 'Research cycle failed');
        }
      }
      if (!researchDone) throw new Error('Research timed out');

      // Step 2: Ideation
      setPipeline('ideating');
      const ideationRes = await fetch(`/api/products/${productId}/ideation/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cycle_id }),
      });
      if (!ideationRes.ok) {
        const err = await ideationRes.json().catch(() => ({ error: 'Ideation failed' }));
        throw new Error(err.error || `Ideation failed (${ideationRes.status})`);
      }

      // Poll until ideation completes
      const { ideation_id } = await ideationRes.json();
      const ideaStart = Date.now();
      while (Date.now() - ideaStart < maxWait) {
        await new Promise(r => setTimeout(r, 5000));
        const statusRes = await fetch(`/api/products/${productId}/ideation/cycles`);
        if (statusRes.ok) {
          const cycles = await statusRes.json();
          const cycle = cycles.find((c: { id: string }) => c.id === ideation_id);
          if (cycle?.status === 'completed') { setPipeline('done'); return; }
          if (cycle?.status === 'failed') throw new Error(cycle.error_message || 'Ideation cycle failed');
        }
      }
      throw new Error('Ideation timed out');
    } catch (err) {
      setPipelineError((err as Error).message);
      setPipeline('error');
    }
  }, [productId, pipeline]);

  // Auto-reset "done" state after 3 seconds so button is clickable again
  useEffect(() => {
    if (pipeline === 'done') {
      const t = setTimeout(() => setPipeline('idle'), 3000);
      return () => clearTimeout(t);
    }
  }, [pipeline]);

  function openSettings() {
    if (!product) return;
    setSettingsForm({
      name: product.name,
      description: product.description || '',
      repo_url: product.repo_url || '',
      live_url: product.live_url || '',
      default_branch: product.default_branch || 'main',
      build_mode: product.build_mode || 'plan_first',
      icon: product.icon || '📦',
    });
    setSettingsError(null);
    setSettingsSaved(false);
    setShowSettings(true);
  }

  async function saveSettings() {
    setSettingsSaving(true);
    setSettingsError(null);
    setSettingsSaved(false);
    try {
      const body: Record<string, unknown> = {
        name: settingsForm.name,
        description: settingsForm.description || undefined,
        repo_url: settingsForm.repo_url || null,
        live_url: settingsForm.live_url || null,
        default_branch: settingsForm.default_branch || 'main',
        build_mode: settingsForm.build_mode,
        icon: settingsForm.icon,
      };
      const res = await fetch(`/api/products/${productId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Save failed' }));
        throw new Error(err.error || `Save failed (${res.status})`);
      }
      const updated = await res.json();
      setProduct(updated);
      setSettingsSaved(true);
      setTimeout(() => { setSettingsSaved(false); setShowSettings(false); }, 800);
    } catch (err) {
      setSettingsError((err as Error).message);
    } finally {
      setSettingsSaving(false);
    }
  }

  if (loading || !product) {
    return (
      <div className="min-h-screen bg-mc-bg flex items-center justify-center">
        <div className="text-mc-text-secondary animate-pulse">Loading product...</div>
      </div>
    );
  }

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'swipe', label: 'Swipe', icon: <Play className="w-4 h-4" /> },
    { id: 'ideas', label: 'Ideas', icon: <Lightbulb className="w-4 h-4" /> },
    { id: 'research', label: 'Research', icon: <Layers className="w-4 h-4" /> },
    { id: 'build', label: 'Build Queue', icon: <Layers className="w-4 h-4" /> },
    { id: 'maybe', label: 'Maybe', icon: <Layers className="w-4 h-4" /> },
    { id: 'costs', label: 'Costs', icon: <BarChart3 className="w-4 h-4" /> },
    { id: 'program', label: 'Program', icon: <FileText className="w-4 h-4" /> },
  ];

  return (
    <div className="min-h-screen bg-mc-bg flex flex-col">
      {/* Header */}
      <header className="border-b border-mc-border bg-mc-bg-secondary px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/autopilot" className="text-mc-text-secondary hover:text-mc-text">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <span className="text-2xl">{product.icon}</span>
            <div>
              <h1 className="font-semibold text-mc-text">{product.name}</h1>
              <span className={`text-xs ${product.status === 'active' ? 'text-green-400' : 'text-mc-text-secondary'}`}>
                {product.status}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Run Now — fires research → ideation pipeline */}
            <button
              onClick={runNow}
              disabled={pipeline !== 'idle' && pipeline !== 'done' && pipeline !== 'error'}
              className={`min-h-11 px-4 rounded-lg flex items-center gap-2 text-sm font-medium transition-colors ${
                pipeline === 'idle' || pipeline === 'done' || pipeline === 'error'
                  ? 'bg-amber-500 text-black hover:bg-amber-400'
                  : 'bg-amber-500/30 text-amber-300 cursor-wait'
              }`}
            >
              {(pipeline === 'idle' || pipeline === 'done' || pipeline === 'error') && (
                <>
                  <Zap className="w-4 h-4" />
                  Run Now
                </>
              )}
              {pipeline === 'researching' && (
                <>
                  <Loader className="w-4 h-4 animate-spin" />
                  Researching...
                </>
              )}
              {pipeline === 'ideating' && (
                <>
                  <Loader className="w-4 h-4 animate-spin" />
                  Generating ideas...
                </>
              )}
            </button>
            {pipelineError && (
              <span className="text-xs text-red-400 max-w-48 truncate" title={pipelineError}>
                {pipelineError}
              </span>
            )}
            <Link
              href={`/autopilot/${productId}/swipe`}
              className="min-h-11 px-4 rounded-lg bg-mc-accent text-white hover:bg-mc-accent/90 flex items-center gap-2 text-sm font-medium"
            >
              <Rocket className="w-4 h-4" />
              Full Screen Swipe
            </Link>
            <button
              onClick={openSettings}
              className="min-h-11 w-11 rounded-lg bg-mc-bg-tertiary border border-mc-border text-mc-text-secondary hover:text-mc-text flex items-center justify-center"
              title="Product Settings"
            >
              <Settings className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      {/* Tabs */}
      <div className="border-b border-mc-border bg-mc-bg-secondary px-4 overflow-x-auto">
        <div className="flex gap-1 min-w-max">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                tab === t.id
                  ? 'border-mc-accent text-mc-accent'
                  : 'border-transparent text-mc-text-secondary hover:text-mc-text'
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content: two-column layout on desktop */}
      <div className="flex-1 flex min-h-0">
        <div className="flex-1 p-4 overflow-auto">
          {tab === 'swipe' && <SwipeDeck productId={productId} />}
          {tab === 'ideas' && <IdeasList productId={productId} />}
          {tab === 'research' && <ResearchReport productId={productId} />}
          {tab === 'build' && <BuildQueue productId={productId} />}
          {tab === 'maybe' && <MaybePool productId={productId} />}
          {tab === 'costs' && <CostDashboard productId={productId} />}
          {tab === 'program' && <ProductProgramEditor product={product} onSave={setProduct} />}
        </div>

        {/* Activity panel — desktop: right side column, mobile: floating button + drawer */}
        <ActivityPanel productId={productId} />
      </div>

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => setShowSettings(false)} />
          <div className="relative bg-mc-bg-secondary border border-mc-border rounded-xl w-full max-w-lg mx-4 max-h-[85vh] overflow-y-auto">
            <div className="sticky top-0 bg-mc-bg-secondary border-b border-mc-border px-5 py-4 flex items-center justify-between rounded-t-xl">
              <h2 className="text-lg font-semibold text-mc-text">Product Settings</h2>
              <button onClick={() => setShowSettings(false)} className="text-mc-text-secondary hover:text-mc-text">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {settingsError && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 text-sm text-red-400">{settingsError}</div>
              )}

              <div className="flex gap-3">
                <div className="w-16">
                  <label className="block text-xs font-medium text-mc-text-secondary uppercase tracking-wider mb-1">Icon</label>
                  <input
                    type="text"
                    value={settingsForm.icon || ''}
                    onChange={e => setSettingsForm(f => ({ ...f, icon: e.target.value }))}
                    className="w-full bg-mc-bg border border-mc-border rounded-lg px-3 py-2 text-sm text-mc-text text-center text-xl focus:outline-none focus:border-mc-accent"
                    maxLength={4}
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-xs font-medium text-mc-text-secondary uppercase tracking-wider mb-1">Name</label>
                  <input
                    type="text"
                    value={settingsForm.name || ''}
                    onChange={e => setSettingsForm(f => ({ ...f, name: e.target.value }))}
                    className="w-full bg-mc-bg border border-mc-border rounded-lg px-3 py-2 text-sm text-mc-text focus:outline-none focus:border-mc-accent"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-mc-text-secondary uppercase tracking-wider mb-1">Description</label>
                <textarea
                  value={settingsForm.description || ''}
                  onChange={e => setSettingsForm(f => ({ ...f, description: e.target.value }))}
                  className="w-full bg-mc-bg border border-mc-border rounded-lg px-3 py-2 text-sm text-mc-text resize-none focus:outline-none focus:border-mc-accent"
                  rows={2}
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-mc-text-secondary uppercase tracking-wider mb-1">Repository URL</label>
                <div className="flex gap-2">
                  <input
                    type="url"
                    value={settingsForm.repo_url || ''}
                    onChange={e => setSettingsForm(f => ({ ...f, repo_url: e.target.value }))}
                    className="flex-1 bg-mc-bg border border-mc-border rounded-lg px-3 py-2 text-sm text-mc-text focus:outline-none focus:border-mc-accent"
                    placeholder="https://github.com/org/repo"
                  />
                  {settingsForm.repo_url && (
                    <a href={settingsForm.repo_url} target="_blank" rel="noopener noreferrer"
                      className="px-3 flex items-center bg-mc-bg border border-mc-border rounded-lg text-mc-text-secondary hover:text-mc-text">
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-mc-text-secondary uppercase tracking-wider mb-1">Live URL</label>
                <div className="flex gap-2">
                  <input
                    type="url"
                    value={settingsForm.live_url || ''}
                    onChange={e => setSettingsForm(f => ({ ...f, live_url: e.target.value }))}
                    className="flex-1 bg-mc-bg border border-mc-border rounded-lg px-3 py-2 text-sm text-mc-text focus:outline-none focus:border-mc-accent"
                    placeholder="https://yourproduct.com"
                  />
                  {settingsForm.live_url && (
                    <a href={settingsForm.live_url} target="_blank" rel="noopener noreferrer"
                      className="px-3 flex items-center bg-mc-bg border border-mc-border rounded-lg text-mc-text-secondary hover:text-mc-text">
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  )}
                </div>
              </div>

              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="block text-xs font-medium text-mc-text-secondary uppercase tracking-wider mb-1">Default Branch</label>
                  <input
                    type="text"
                    value={settingsForm.default_branch || ''}
                    onChange={e => setSettingsForm(f => ({ ...f, default_branch: e.target.value }))}
                    className="w-full bg-mc-bg border border-mc-border rounded-lg px-3 py-2 text-sm text-mc-text focus:outline-none focus:border-mc-accent"
                    placeholder="main"
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-xs font-medium text-mc-text-secondary uppercase tracking-wider mb-1">Build Mode</label>
                  <select
                    value={settingsForm.build_mode || 'plan_first'}
                    onChange={e => setSettingsForm(f => ({ ...f, build_mode: e.target.value }))}
                    className="w-full bg-mc-bg border border-mc-border rounded-lg px-3 py-2 text-sm text-mc-text focus:outline-none focus:border-mc-accent"
                  >
                    <option value="plan_first">Plan First</option>
                    <option value="auto_build">Auto Build</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="sticky bottom-0 bg-mc-bg-secondary border-t border-mc-border px-5 py-4 flex items-center justify-end gap-3 rounded-b-xl">
              <button
                onClick={() => setShowSettings(false)}
                className="min-h-9 px-4 rounded-lg text-sm text-mc-text-secondary hover:text-mc-text"
              >
                Cancel
              </button>
              <button
                onClick={saveSettings}
                disabled={settingsSaving}
                className={`min-h-9 px-4 rounded-lg flex items-center gap-2 text-sm font-medium ${
                  settingsSaved
                    ? 'bg-green-500/20 text-green-400'
                    : 'bg-mc-accent text-white hover:bg-mc-accent/90'
                }`}
              >
                {settingsSaving ? <Loader className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                {settingsSaved ? 'Saved' : settingsSaving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
