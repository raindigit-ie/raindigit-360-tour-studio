export type MovementStatus = "Position saved" | "Needs a position";

export interface MovementRow {
  sourceId: string;
  hotspotIndex: number;
  targetId: string;
  title: string;
  subtitle: string;
  status: MovementStatus;
  thumbnail: string;
  selected: boolean;
  positioned: boolean;
}

export interface WalkingButtonListProps {
  rows: MovementRow[];
  onSelect: (row: MovementRow) => void;
}
