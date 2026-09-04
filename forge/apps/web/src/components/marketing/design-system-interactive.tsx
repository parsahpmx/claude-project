'use client';

import { useState } from 'react';
import { Card } from '@/components/ui/primitives';
import {
  ChoiceCard, Checkbox, FilterChips, SearchInput, Select, Tabs, TextArea, TextInput, Toggle,
} from '@/components/ui/forms';

/** The interactive half of the design system page. */
export function DesignSystemInteractive() {
  const [choice, setChoice] = useState('build-muscle');
  const [multi, setMulti] = useState<string[]>(['dumbbells']);
  const [toggled, setToggled] = useState(false);
  const [checked, setChecked] = useState(true);
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState('overview');
  const [chips, setChips] = useState<string[]>(['strength']);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <p className="eyebrow mb-5">Inputs</p>
        <div className="space-y-5">
          <TextInput label="Email" type="email" placeholder="you@example.com" />
          <TextInput label="Password" type="password" error="Use at least 10 characters." />
          <Select
            label="Training days per week"
            options={[3, 4, 5].map((n) => ({ value: String(n), label: `${n} days` }))}
          />
          <TextArea label="Coach note" hint="What to focus on this week." />
          <SearchInput value={search} onChange={setSearch} label="Search" placeholder="Search programmes" />
        </div>
      </Card>

      <div className="space-y-6">
        <Card>
          <p className="eyebrow mb-5">Choice cards</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              { value: 'build-muscle', label: 'Build Muscle', description: 'Hypertrophy volume with progressive overload.' },
              { value: 'improve-strength', label: 'Improve Strength', description: 'Heavy compounds, low fatigue, long rest.' },
            ].map((option) => (
              <ChoiceCard
                key={option.value}
                name="goal"
                value={option.value}
                label={option.label}
                description={option.description}
                checked={choice === option.value}
                onChange={setChoice}
              />
            ))}
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {['dumbbells', 'barbell'].map((value) => (
              <ChoiceCard
                key={value}
                name="equipment"
                value={value}
                label={value.charAt(0).toUpperCase() + value.slice(1)}
                checked={multi.includes(value)}
                onChange={(v) => setMulti((c) => (c.includes(v) ? c.filter((x) => x !== v) : [...c, v]))}
                multi
              />
            ))}
          </div>
        </Card>

        <Card>
          <p className="eyebrow mb-5">Controls</p>
          <div className="space-y-6">
            <Toggle checked={toggled} onChange={setToggled} labels={['Monthly', 'Yearly']} />
            <Checkbox
              label="I understand my trial ends on 11 September 2026 and I will then be charged $49 per month."
              checked={checked}
              onChange={setChecked}
            />
            <FilterChips
              label="Training style"
              options={[
                { value: 'strength', label: 'Strength' },
                { value: 'hiit', label: 'HIIT' },
                { value: 'running', label: 'Running' },
                { value: 'mobility', label: 'Mobility' },
              ]}
              selected={chips}
              onChange={setChips}
              multi
            />
            <Tabs
              tabs={[
                { value: 'overview', label: 'Overview' },
                { value: 'strength', label: 'Strength', count: 6 },
                { value: 'body', label: 'Body' },
              ]}
              active={tab}
              onChange={setTab}
            />
          </div>
        </Card>
      </div>
    </div>
  );
}
