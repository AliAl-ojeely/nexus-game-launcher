// Switch only Settings sections. Existing controls remain mounted and unchanged.
export function initSettingsNavigation() {
    const page = document.getElementById('settingsArea');
    if (!page) return;

    const tabs = [...page.querySelectorAll('[data-settings-tab]')];
    const panels = [...page.querySelectorAll('.settings-panel[role="tabpanel"]')];
    const scroller = document.getElementById('settingsPanelScroll');
    const navList = page.querySelector('.settings-navigation');
    if (tabs.length !== 4 || panels.length !== 4) return;

    function activateSection(id, focusTab = false) {
        const selected = tabs.find(tab => tab.dataset.settingsTab === id);
        if (!selected) return;

        tabs.forEach(tab => {
            const active = tab === selected;
            tab.classList.toggle('is-active', active);
            tab.setAttribute('aria-selected', String(active));
            tab.tabIndex = active ? 0 : -1;
        });
        panels.forEach(panel => {
            panel.hidden = panel.id !== selected.getAttribute('aria-controls');
        });
        if (scroller) scroller.scrollTop = 0;
        if (focusTab) selected.focus();
    }

    navList?.setAttribute('aria-orientation', 'horizontal');

    tabs.forEach((tab, index) => {
        tab.addEventListener('click', () => activateSection(tab.dataset.settingsTab));
        tab.addEventListener('keydown', event => {
            const forward = document.documentElement.dir === 'rtl' ? 'ArrowLeft' : 'ArrowRight';
            const backward = document.documentElement.dir === 'rtl' ? 'ArrowRight' : 'ArrowLeft';
            let next;
            if (event.key === forward) next = (index + 1) % tabs.length;
            else if (event.key === backward) next = (index + tabs.length - 1) % tabs.length;
            else if (event.key === 'Home') next = 0;
            else if (event.key === 'End') next = tabs.length - 1;
            else return;
            event.preventDefault();
            event.stopPropagation();
            activateSection(tabs[next].dataset.settingsTab, true);
        });
    });

    // Always open General when the user re-enters Settings from any route.
    document.querySelector('.nav-item[data-target="settingsArea"]')
        ?.addEventListener('click', () => activateSection('general'));
    let wasActive = page.classList.contains('active');
    const observer = new MutationObserver(() => {
        const active = page.classList.contains('active');
        if (active && !wasActive) activateSection('general');
        wasActive = active;
    });
    observer.observe(page, { attributes: true, attributeFilter: ['class'] });
    activateSection('general');
}
