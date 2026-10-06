// Player settings, saved on the device, and the pause-menu UI for changing them.

const STORAGE_KEY = 'touge.settings.v1';

export const DEFAULTS = {
  transmission: 'manual', // 'manual-clutch' | 'manual' | 'auto'
  steering: 'slider', // 'slider' | 'buttons'
  steerAssist: true,
  time: 'auto', // 'auto' | 'sunrise' | 'day' | 'sunset' | 'night'
  cycleMinutes: 24, // position in the automatic day/night cycle
  units: 'kmh', // 'kmh' | 'mph'
  camera: 'chase', // 'chase' | 'hood'
  resolution: 240,
  sound: true,
};

export const OPTIONS = [
  {
    key: 'transmission',
    label: 'Transmission',
    choices: [
      ['manual-clutch', 'Manual + clutch'],
      ['manual', 'Manual'],
      ['auto', 'Automatic'],
    ],
  },
  {
    key: 'steering',
    label: 'Steering',
    choices: [
      ['slider', 'Slider'],
      ['buttons', 'Buttons'],
    ],
  },
  {
    key: 'steerAssist',
    label: 'Steering assist',
    choices: [
      [true, 'On'],
      [false, 'Off'],
    ],
  },
  {
    key: 'time',
    label: 'Time of day',
    choices: [
      ['auto', 'Auto cycle'],
      ['sunrise', 'Sunrise'],
      ['day', 'Daytime'],
      ['sunset', 'Sunset'],
      ['night', 'Night'],
    ],
  },
  {
    key: 'camera',
    label: 'Camera',
    choices: [
      ['chase', 'Chase'],
      ['hood', 'Hood'],
    ],
  },
  {
    key: 'units',
    label: 'Speed',
    choices: [
      ['kmh', 'km/h'],
      ['mph', 'mph'],
    ],
  },
  {
    key: 'resolution',
    label: 'Resolution',
    choices: [
      [240, '240p (classic)'],
      [360, '360p'],
    ],
  },
  {
    key: 'sound',
    label: 'Sound',
    choices: [
      [true, 'On'],
      [false, 'Off'],
    ],
  },
];

export function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return { ...DEFAULTS, ...(saved || {}) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Not fatal: settings then last for this session only.
  }
}

// Renders option rows into `container`; calls onChange(key, value) when the player picks something.
export function renderSettings(container, settings, onChange) {
  container.innerHTML = '';
  for (const opt of OPTIONS) {
    const row = document.createElement('div');
    row.className = 'opt-row';
    const label = document.createElement('div');
    label.className = 'opt-label';
    label.textContent = opt.label;
    const choices = document.createElement('div');
    choices.className = 'opt-choices';
    for (const [value, text] of opt.choices) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = text;
      if (settings[opt.key] === value) b.classList.add('sel');
      b.addEventListener('click', () => {
        onChange(opt.key, value);
        renderSettings(container, settings, onChange);
      });
      choices.appendChild(b);
    }
    row.append(label, choices);
    container.appendChild(row);
  }
}
