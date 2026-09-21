import {describe, expect, it} from 'vitest';
import {EditorState} from '../editor/EditorState';

describe('EditorState command notifications', () => {
  it('notifies listeners after undo and redo stacks are consistent', () => {
    const state = new EditorState();
    const observed: Array<{canUndo: boolean; canRedo: boolean}> = [];
    state.onChange(() => observed.push({canUndo: state.canUndo, canRedo: state.canRedo}));

    state.addCharacter({
      id: 'player-1', x: 2.5, y: 2.5, z: 0, radius: 20, color: '#5590cc',
    });
    expect(observed[observed.length - 1]).toEqual({canUndo: true, canRedo: false});

    state.undo();
    expect(state.getById('player-1')).toBeUndefined();
    expect(observed[observed.length - 1]).toEqual({canUndo: false, canRedo: true});

    state.redo();
    expect(state.getById('player-1')).toBeDefined();
    expect(observed[observed.length - 1]).toEqual({canUndo: true, canRedo: false});
  });

  it('preserves editable fields for the common garden props', () => {
    const state = new EditorState();
    state.addProp({
      id: 'tree-1', kind: 'tree', x: 2.5, y: 3.5, color: '#4f9d68',
      trunkColor: '#80583f', heightPx: 72, scale: 1.1,
    });
    state.addProp({
      id: 'flowers-1', kind: 'flowers', x: 4.5, y: 3.5, color: '#f47ca5',
      accentColor: '#fff0a6', count: 8, seed: 4.2,
    });
    state.addProp({
      id: 'lantern-1', kind: 'lantern', x: 5.5, y: 3.5, color: '#ffd166',
      postColor: '#40504b', heightPx: 52,
    });

    const restored = new EditorState();
    restored.loadJSON(state.toJSON());

    expect(restored.scene.props).toEqual(state.scene.props);
  });
});
