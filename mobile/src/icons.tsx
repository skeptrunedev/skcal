import Svg, { Path, Rect, Circle, Line } from "react-native-svg";

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
