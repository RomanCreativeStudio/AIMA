import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Task } from '../tasks/types';
import {
  extractKeywords,
  findCompletedRecently,
  findDueSoon,
  findOverdue,
  groupRelatedTasks,
  isOpenTask,
  matchOpenTask,
  rankTasksByPriority,
  scoreTaskPriority,
} from './taskAnalysis';

const NOW = new Date('2026-07-28T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const DUE_SOON_WINDOW_MS = 3 * DAY_MS;

let taskCounter = 0;
function makeTask(overrides: Partial<Task> = {}): Task {
  taskCounter += 1;
  return {
    id: `task-${taskCounter}`,
    workspaceId: 'ws-1',
    title: `Task ${taskCounter}`,
    description: null,
    status: 'todo',
    priority: 'medium',
    dueDate: null,
    source: null,
    metadata: {},
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

test('isOpenTask is true for todo/in_progress and false for done/cancelled', () => {
  assert.equal(isOpenTask(makeTask({ status: 'todo' })), true);
  assert.equal(isOpenTask(makeTask({ status: 'in_progress' })), true);
  assert.equal(isOpenTask(makeTask({ status: 'done' })), false);
  assert.equal(isOpenTask(makeTask({ status: 'cancelled' })), false);
});

test('scoreTaskPriority ranks overdue above due-soon above a bare declared priority', () => {
  const overdue = makeTask({ priority: 'low', dueDate: new Date(NOW.getTime() - DAY_MS).toISOString() });
  const dueSoon = makeTask({ priority: 'low', dueDate: new Date(NOW.getTime() + DAY_MS).toISOString() });
  const noDueDate = makeTask({ priority: 'high' });

  const overdueScore = scoreTaskPriority(overdue, NOW, DUE_SOON_WINDOW_MS);
  const dueSoonScore = scoreTaskPriority(dueSoon, NOW, DUE_SOON_WINDOW_MS);
  const noDueDateScore = scoreTaskPriority(noDueDate, NOW, DUE_SOON_WINDOW_MS);

  assert.ok(overdueScore > dueSoonScore, 'overdue must outrank due-soon even at a lower declared priority');
  assert.ok(dueSoonScore > noDueDateScore, 'due-soon must outrank a bare high-priority task with no due date');
});

test('scoreTaskPriority ranks high over medium over low at equal urgency', () => {
  const high = scoreTaskPriority(makeTask({ priority: 'high' }), NOW, DUE_SOON_WINDOW_MS);
  const medium = scoreTaskPriority(makeTask({ priority: 'medium' }), NOW, DUE_SOON_WINDOW_MS);
  const low = scoreTaskPriority(makeTask({ priority: 'low' }), NOW, DUE_SOON_WINDOW_MS);

  assert.ok(high > medium);
  assert.ok(medium > low);
});

test('rankTasksByPriority sorts descending by score, tie-breaking on due date then createdAt', () => {
  const noDueOld = makeTask({ id: 'a', priority: 'low', createdAt: '2026-01-01T00:00:00.000Z' });
  const noDueNew = makeTask({ id: 'b', priority: 'low', createdAt: '2026-06-01T00:00:00.000Z' });
  const overdue = makeTask({ id: 'c', priority: 'low', dueDate: new Date(NOW.getTime() - DAY_MS).toISOString() });

  const ranked = rankTasksByPriority([noDueNew, overdue, noDueOld], NOW, DUE_SOON_WINDOW_MS);

  assert.deepEqual(ranked.map((task) => task.id), ['c', 'a', 'b'], 'overdue first, then oldest-created of the remaining ties');
});

test('findOverdue returns only tasks whose dueDate is strictly before now', () => {
  const overdue = makeTask({ dueDate: new Date(NOW.getTime() - DAY_MS).toISOString() });
  const future = makeTask({ dueDate: new Date(NOW.getTime() + DAY_MS).toISOString() });
  const noDueDate = makeTask();

  const result = findOverdue([overdue, future, noDueDate], NOW);

  assert.deepEqual(result.map((task) => task.id), [overdue.id]);
});

test('findDueSoon excludes tasks already overdue and tasks past the window', () => {
  const overdue = makeTask({ dueDate: new Date(NOW.getTime() - DAY_MS).toISOString() });
  const withinWindow = makeTask({ dueDate: new Date(NOW.getTime() + DAY_MS).toISOString() });
  const beyondWindow = makeTask({ dueDate: new Date(NOW.getTime() + 10 * DAY_MS).toISOString() });
  const noDueDate = makeTask();

  const result = findDueSoon([overdue, withinWindow, beyondWindow, noDueDate], NOW, DUE_SOON_WINDOW_MS);

  assert.deepEqual(result.map((task) => task.id), [withinWindow.id]);
});

test('findDueSoon includes a task due exactly at the window boundary', () => {
  const atBoundary = makeTask({ dueDate: new Date(NOW.getTime() + DUE_SOON_WINDOW_MS).toISOString() });
  const result = findDueSoon([atBoundary], NOW, DUE_SOON_WINDOW_MS);
  assert.deepEqual(result.map((task) => task.id), [atBoundary.id]);
});

test('extractKeywords lowercases, dedupes, and drops short words and stopwords', () => {
  const keywords = extractKeywords('Follow up with Acme about the Proposal Proposal');
  assert.deepEqual(keywords.sort(), ['acme', 'proposal'].sort());
});

test('groupRelatedTasks groups only keywords shared by 2+ open tasks, sorted by group size then alphabetically', () => {
  const acme1 = makeTask({ id: 'acme-1', title: 'Send Acme contract' });
  const acme2 = makeTask({ id: 'acme-2', title: 'Review Acme contract terms' });
  const acme3 = makeTask({ id: 'acme-3', title: 'Acme kickoff notes' });
  const unrelated = makeTask({ id: 'solo', title: 'Buy coffee filters' });

  const groups = groupRelatedTasks([acme1, acme2, acme3, unrelated]);

  const acmeGroup = groups.find((group) => group.keyword === 'acme');
  assert.ok(acmeGroup, 'a keyword shared by 3 tasks must appear as a group');
  assert.deepEqual(acmeGroup!.taskIds.sort(), ['acme-1', 'acme-2', 'acme-3'].sort());

  const contractGroup = groups.find((group) => group.keyword === 'contract');
  assert.ok(contractGroup, 'a keyword shared by exactly 2 tasks must still appear');
  assert.deepEqual(contractGroup!.taskIds.sort(), ['acme-1', 'acme-2'].sort());

  assert.equal(groups.some((group) => group.taskIds.length < 2), false, 'no single-task groups');
  assert.ok(groups[0].keyword === 'acme', 'largest group sorts first');
});

test('groupRelatedTasks returns no groups when no keyword is shared by more than one task', () => {
  const a = makeTask({ title: 'Buy coffee filters' });
  const b = makeTask({ title: 'Schedule dentist appointment' });

  assert.deepEqual(groupRelatedTasks([a, b]), []);
});

test('matchOpenTask returns the open task with the highest keyword overlap', () => {
  const weak = makeTask({ id: 'weak', title: 'Acme kickoff notes' });
  const strong = makeTask({ id: 'strong', title: 'Acme contract proposal review' });

  const result = matchOpenTask('Blocked on the Acme contract proposal', [weak, strong]);

  assert.equal(result?.id, 'strong');
});

test('matchOpenTask returns null when no open task shares a keyword', () => {
  const unrelated = makeTask({ title: 'Buy coffee filters' });
  assert.equal(matchOpenTask('Blocked on the Acme contract', [unrelated]), null);
});

test('matchOpenTask returns null for content with no significant keywords', () => {
  const candidate = makeTask({ title: 'Acme contract' });
  assert.equal(matchOpenTask('ok', [candidate]), null);
});

test('matchOpenTask breaks ties by most recently created', () => {
  const older = makeTask({ id: 'older', title: 'Acme contract', createdAt: '2026-01-01T00:00:00.000Z' });
  const newer = makeTask({ id: 'newer', title: 'Acme contract', createdAt: '2026-06-01T00:00:00.000Z' });

  const result = matchOpenTask('Blocked on the Acme contract', [older, newer]);

  assert.equal(result?.id, 'newer');
});

test('findCompletedRecently returns only done tasks updated within the window', () => {
  const recentlyDone = makeTask({
    id: 'recent',
    status: 'done',
    updatedAt: new Date(NOW.getTime() - 2 * 60 * 60 * 1000).toISOString(),
  });
  const staleDone = makeTask({ id: 'stale', status: 'done', updatedAt: new Date(NOW.getTime() - 2 * DAY_MS).toISOString() });
  const stillOpen = makeTask({ id: 'open', status: 'todo', updatedAt: new Date(NOW.getTime() - 60 * 1000).toISOString() });

  const result = findCompletedRecently([recentlyDone, staleDone, stillOpen], NOW, DAY_MS);

  assert.deepEqual(result.map((task) => task.id), ['recent']);
});
