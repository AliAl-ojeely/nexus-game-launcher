"""Patch guards: malformed anchors, duplicate applications, wrong baselines.
Run with: py -3 -B tests/test_multi_game_patches_v100.py
"""
import importlib.util
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
# On a checked-out Nexus project, patches.py stays in the kit, not the repo.
# This test intentionally tests the installed code, not an installer dependency.


class InstalledCode(unittest.TestCase):
    def read(self, name):
        return (ROOT / name).read_text(encoding='utf-8')

    def test_all_source_files_exist(self):
        for name in ('modules/game-launcher.js','render/details/init.js',
                     'render/details/page.js','render/details/handlers.js',
                     'src/main.js','src/preload.js'):
            self.assertTrue((ROOT/name).is_file(),name)

    def test_game_events_carry_session_identity(self):
        text=self.read('modules/game-launcher.js')
        for event in ("'game:started'", "'game:stopped'", "'game:tick'", "'game:timer-state'"):
            self.assertIn(event,text)
        self.assertIn('sessionId: game.sessionId',text)
        self.assertIn('sessionId, elapsed: 0',text)

    def test_backend_guards_same_game_double_launch(self):
        text=self.read('modules/game-launcher.js')
        self.assertIn('const existing = runningGames.get(gameId);',text)
        self.assertIn('if (existing) {',text)
        self.assertIn('if (current !== game || current.stopping) return;',text)

    def test_backend_keeps_per_game_maps(self):
        text=self.read('modules/game-launcher.js')
        for token in ('runningGames = new Map()', 'gameMonitors = new Map()',
                      'gameTimers = new Map()', 'getRunningSessions()'):
            self.assertIn(token,text)

    def test_renderer_never_reuses_global_timer_for_other_game(self):
        text=self.read('render/details/init.js')
        self.assertNotIn('session.startTime = Date.now()',text)
        self.assertIn('liveSessions.tick(data)',text)
        self.assertIn('liveSessions.stop(data)',text)
        self.assertIn('liveSessions.failed(data)',text)
        self.assertIn('refreshVisibleSession()',text)
        self.assertNotIn('window.api.onGameStarted(() =>',text)

    def test_selected_detail_guard_and_backend_recovery(self):
        page=self.read('render/details/page.js')
        self.assertIn('paintDetailsSession(document, liveSessions, game.id',page)
        handler=self.read('render/details/handlers.js')
        self.assertIn('isCurrentView()',handler)
        self.assertNotIn('state.isGameRunning = false;',handler)
        self.assertIn('finalizingSessions',handler)
        self.assertIn("ipcMain.handle('game:get-running-sessions'",self.read('src/main.js'))
        self.assertIn('getRunningGameSessions:',self.read('src/preload.js'))

    def test_no_native_or_overlay_source_in_fix(self):
        self.assertTrue((ROOT/'render/details/live-sessions.mjs').is_file())
        self.assertTrue((ROOT/'render/details/session-presentation.mjs').is_file())


if __name__=='__main__':
    unittest.main(verbosity=2)
