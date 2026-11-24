"""Pure Start button edge cases; no Windows hooks or game launched."""
import pathlib
import sys
import unittest
root=pathlib.Path(__file__).resolve().parents[1]
tools=root/'tools'
sys.path.insert(0,str(tools if (tools/'nexus_overlay_quick_input_v103.py').exists() else root/'src'))
from nexus_overlay_quick_input_v103 import start_release_edge, START, BACK

class StartInputTests(unittest.TestCase):
    def test_start_only_on_release(self):
        tap,p,c=start_release_edge(0,START,False,False,True)
        self.assertEqual((tap,p,c),(False,True,False))
        tap,p,c=start_release_edge(START,START,p,c,True)
        self.assertFalse(tap)
        self.assertEqual(start_release_edge(START,0,p,c,True),(True,False,False))

    def test_existing_combo_from_start_first_never_double_toggles(self):
        tap,p,c=start_release_edge(0,START,False,False,True)
        tap,p,c=start_release_edge(START,START|BACK,p,c,True)
        self.assertFalse(tap)
        self.assertTrue(c)
        tap,p,c=start_release_edge(START|BACK,BACK,p,c,True)
        self.assertFalse(tap)

    def test_existing_combo_from_back_first_never_emits_single_start(self):
        tap,p,c=start_release_edge(BACK,START|BACK,False,False,True)
        self.assertFalse(tap)
        tap,p,c=start_release_edge(START|BACK,0,p,c,True)
        self.assertFalse(tap)

    def test_disabled_never_triggers(self):
        tap,p,c=start_release_edge(0,START,False,False,False)
        self.assertFalse(tap)
        self.assertEqual(start_release_edge(START,0,p,c,False),(False,False,False))

    def test_repeated_polls_do_not_toggle(self):
        pending=cancelled=False
        previous=0
        count=0
        for current in (START,START,START,START,0,0,0):
            tap,pending,cancelled=start_release_edge(previous,current,pending,cancelled,True)
            count+=bool(tap)
            previous=current
        self.assertEqual(count,1)

    def test_cancelled_start_is_cleared_on_release(self):
        _,p,c=start_release_edge(0,START,False,False,True)
        _,p,c=start_release_edge(START,START|BACK,p,c,True)
        _,p,c=start_release_edge(START|BACK,0,p,c,True)
        self.assertEqual((p,c),(False,False))
        _,p,c=start_release_edge(0,START,p,c,True)
        self.assertEqual(start_release_edge(START,0,p,c,True)[0],True)

if __name__=='__main__': unittest.main(verbosity=2)
