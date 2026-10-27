import Svg, { G, Path, Rect, Circle, Line } from "react-native-svg";

// Hand-inlined lucide glyphs (24x24 stroke icons) so the drawer/topbar match
// the web app without pulling in an icon library.
type P = { size?: number; color: string };
const base = (size = 20) =>
  ({ width: size, height: size, viewBox: "0 0 24 24", fill: "none", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" }) as const;

export const PanelLeftIcon = ({ size, color }: P) => (
  <Svg {...base(size)} stroke={color}>
    <Rect width={18} height={18} x={3} y={3} rx={2} />
    <Path d="M9 3v18" />
  </Svg>
);

export const SunIcon = ({ size, color }: P) => (
  <Svg {...base(size)} stroke={color}>
    <Circle cx={12} cy={12} r={4} />
    <Path d="M12 2v2" />
    <Path d="M12 20v2" />
    <Path d="m4.93 4.93 1.41 1.41" />
    <Path d="m17.66 17.66 1.41 1.41" />
    <Path d="M2 12h2" />
    <Path d="M20 12h2" />
    <Path d="m6.34 17.66-1.41 1.41" />
    <Path d="m19.07 4.93-1.41 1.41" />
  </Svg>
);

export const MessageSquareIcon = ({ size, color }: P) => (
  <Svg {...base(size)} stroke={color}>
    <Path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </Svg>
);

export const SquarePenIcon = ({ size, color }: P) => (
  <Svg {...base(size)} stroke={color}>
    <Path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <Path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z" />
  </Svg>
);

export const SearchIcon = ({ size, color }: P) => (
  <Svg {...base(size)} stroke={color}>
    <Circle cx={11} cy={11} r={8} />
    <Path d="m21 21-4.3-4.3" />
  </Svg>
);

export const XIcon = ({ size, color }: P) => (
  <Svg {...base(size)} stroke={color}>
    <Path d="M18 6 6 18" />
    <Path d="m6 6 12 12" />
  </Svg>
);

export const TrashIcon = ({ size, color }: P) => (
  <Svg {...base(size)} stroke={color}>
    <Path d="M3 6h18" />
    <Path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
    <Path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <Line x1={10} x2={10} y1={11} y2={17} />
    <Line x1={14} x2={14} y1={11} y2={17} />
  </Svg>
);

export const ActivityIcon = ({ size, color }: P) => (
  <Svg {...base(size)} stroke={color}>
    <Path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2" />
  </Svg>
);

export const DumbbellIcon = ({ size, color }: P) => (
  <Svg {...base(size)} stroke={color}>
    <Path d="M17.596 12.768a2 2 0 1 0 2.829-2.829l-1.768-1.767a2 2 0 0 0 2.828-2.829l-2.828-2.828a2 2 0 0 0-2.829 2.828l-1.767-1.768a2 2 0 1 0-2.829 2.829z" />
    <Path d="m2.5 21.5 1.4-1.4" />
    <Path d="m20.1 3.9 1.4-1.4" />
    <Path d="M5.343 21.485a2 2 0 1 0 2.829-2.828l1.767 1.768a2 2 0 1 0 2.829-2.829l-6.364-6.364a2 2 0 1 0-2.829 2.829l1.768 1.767a2 2 0 0 0-2.828 2.829z" />
    <Path d="m9.6 14.4 4.8-4.8" />
  </Svg>
);

export const CalendarDaysIcon = ({ size, color }: P) => (
  <Svg {...base(size)} stroke={color}>
    <Path d="M8 2v4" />
    <Path d="M16 2v4" />
    <Rect width={18} height={18} x={3} y={4} rx={2} />
    <Path d="M3 10h18" />
    <Path d="M8 14h.01" />
    <Path d="M12 14h.01" />
    <Path d="M16 14h.01" />
    <Path d="M8 18h.01" />
    <Path d="M12 18h.01" />
    <Path d="M16 18h.01" />
  </Svg>
);

export const MoreVerticalIcon = ({ size, color }: P) => (
  <Svg {...base(size)} stroke={color}>
    <Circle cx={12} cy={12} r={1} />
    <Circle cx={12} cy={5} r={1} />
    <Circle cx={12} cy={19} r={1} />
  </Svg>
);

export const CheckIcon = ({ size, color }: P) => (
  <Svg {...base(size)} stroke={color}>
    <Path d="M20 6 9 17l-5-5" />
  </Svg>
);

export const PlusIcon = ({ size, color }: P) => (
  <Svg {...base(size)} stroke={color}>
    <Path d="M5 12h14" />
    <Path d="M12 5v14" />
  </Svg>
);

export const ChevronLeftIcon = ({ size, color }: P) => (
  <Svg {...base(size)} stroke={color}>
    <Path d="m15 18-6-6 6-6" />
  </Svg>
);

export const ChevronRightIcon = ({ size, color }: P) => (
  <Svg {...base(size)} stroke={color}>
    <Path d="m9 18 6-6-6-6" />
  </Svg>
);

export const ChevronDownIcon = ({ size, color }: P) => (
  <Svg {...base(size)} stroke={color}>
    <Path d="m6 9 6 6 6-6" />
  </Svg>
);

export const PlugIcon = ({ size, color }: P) => (
  <Svg {...base(size)} stroke={color}>
    <Path d="M12 22v-5" />
    <Path d="M9 8V2" />
    <Path d="M15 8V2" />
    <Path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z" />
  </Svg>
);

export const CopyIcon = ({ size, color }: P) => (
  <Svg {...base(size)} stroke={color}>
    <Rect width={14} height={14} x={8} y={8} rx={2} ry={2} />
    <Path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
  </Svg>
);

export const ExternalLinkIcon = ({ size, color }: P) => (
  <Svg {...base(size)} stroke={color}>
    <Path d="M15 3h6v6" />
    <Path d="M10 14 21 3" />
    <Path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
  </Svg>
);

export const CameraIcon = ({ size, color }: P) => (
  <Svg {...base(size)} stroke={color}>
    <Path d="M13.997 4a2 2 0 0 1 1.76 1.05l.486.9A2 2 0 0 0 18.003 7H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.997a2 2 0 0 0 1.759-1.048l.489-.904A2 2 0 0 1 10.004 4z" />
    <Circle cx={12} cy={13} r={3} />
  </Svg>
);

export const ImagePlusIcon = ({ size, color }: P) => (
  <Svg {...base(size)} stroke={color}>
    <Path d="M16 5h6" />
    <Path d="M19 2v6" />
    <Path d="M21 11.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7.5" />
    <Path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
    <Circle cx={9} cy={9} r={2} />
  </Svg>
);

export const ArrowUpIcon = ({ size, color }: P) => (
  <Svg {...base(size)} stroke={color}>
    <Path d="m5 12 7-7 7 7" />
    <Path d="M12 19V5" />
  </Svg>
);

// Filled, strokeless square: the stop control (web: fill currentColor, strokeWidth 0).
export const StopIcon = ({ size, color }: P) => (
  <Svg {...base(size)} fill={color} strokeWidth={0}>
    <Rect width={18} height={18} x={3} y={3} rx={2} />
  </Svg>
);

// lucide loader-circle (web's Loader2); spin it with a rotating wrapper.
export const LoaderIcon = ({ size, color }: P) => (
  <Svg {...base(size)} stroke={color}>
    <Path d="M21 12a9 9 0 1 1-6.219-8.56" />
  </Svg>
);

// The skcal brand mark (public/brand-mark.svg on the web), drawn in amber.
export const BrandMark = ({ size = 22 }: { size?: number }) => (
  <Svg width={size} height={size} viewBox="0 0 256 256">
    <G transform="rotate(-16 128 102)">
      <Rect x={56.81} y={58} width={142.39} height={88} rx={31.43} fill="#f59e0b" />
      <Path d="M 103.79 158 L 83.24 177.85 L 63.33 181.36" fill="none" stroke="#f59e0b" strokeWidth={22} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M 149.36 158 L 165.33 181.69 L 156.47 199.86" fill="none" stroke="#f59e0b" strokeWidth={22} strokeLinecap="round" strokeLinejoin="round" />
    </G>
  </Svg>
);
