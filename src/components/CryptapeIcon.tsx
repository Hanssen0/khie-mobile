import Svg, { G, Path } from "react-native-svg";

// Monochrome vector trace of Cryptape's official cryptape-logo-square.png.
// Source: https://github.com/cryptape/assets/blob/master/cryptape-logo-square.png

export function CryptapeIcon({
  color,
  size = 32,
  variant = "filled",
}: {
  color: string;
  size?: number;
  variant?: "outlined" | "filled";
}) {
  return (
    <Svg width={size} height={size} viewBox="-26 -26 347 354">
      <G
        fill={variant === "filled" ? color : "none"}
        stroke={variant === "outlined" ? color : "none"}
        strokeWidth={variant === "outlined" ? 150 : undefined}
        strokeLinejoin="round"
        transform="translate(-1.13789 302.893167) scale(0.1 -0.1)"
      >
        <Path d="M864 3015c-93-29-191-100-234-171-31-50-66-64-158-64-48 0-85-5-96-13-11-8-22-39-31-89-18-108-55-170-131-224-34-24-80-64-104-90-73-80-121-214-86-243 9-7 16-28 16-46s-7-39-16-46c-39-32 18-172 105-259 55-55 174-126 192-114 5 3 9 11 9 19 0 31 93 194 141 248 170 191 436 274 689 215 25-5 88-30 140-55 79-38 107-59 180-132 69-68 95-103 129-171 23-47 49-110 57-140 34-120 27-525-12-672-34-133-108-242-271-398-170-163-291-308-277-331 6-10 1177-13 1186-3 3 3-26 53-66 112-150 226-206 369-214 553-4 99-2 127 16 185 36 119 103 208 206 275 189 124 447 101 615-54l34-32-29 53c-38 71-143 184-216 234-83 56-157 86-274 113-56 13-118 31-138 40-54 26-99 85-140 183-104 251-292 467-508 583-120 65-143 89-157 174-14 79-46 157-88 212-43 56-137 120-210 143-75 23-194 25-259 5zM925 2104c-11-2-45-9-75-15-178-36-352-174-435-344-66-135-65-120-65-952V41l22-15c19-14 64-16 294-16 317 0 302-5 328 104 36 147 109 253 320 461 223 220 267 287 303 465 23 117 24 495 0 580-62 228-241 409-461 465-63 16-197 27-231 19zM2365 1369c-190-65-305-229-305-431 0-84 24-208 55-283 50-120 106-213 255-425 37-52 78-115 90-140 42-84 28-80 261-80 203 0 208 0 223 22 14 20 16 82 16 483 0 495-4 534-54 633-98 192-338 291-541 221z" />
      </G>
    </Svg>
  );
}

export function cryptapeIconSource({
  color,
  size,
}: {
  color: string;
  size: number;
}) {
  return <CryptapeIcon color={color} size={size} />;
}

export function cryptapeOutlinedIconSource({
  color,
  size,
}: {
  color: string;
  size: number;
}) {
  return <CryptapeIcon color={color} size={size} variant="outlined" />;
}
