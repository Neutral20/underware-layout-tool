// Underware for openGrid by David D (CC BY-NC-SA 4.0), clip-on channels
// that snap straight onto openGrid. The pieces are the meshes from the
// original 3MF; this file picks one, or builds a straight of any length by
// repeating the 1-cell straight every 28 mm (checked against the 3MF's own
// 2x to 8x straights: same size and volume).

// Piece id from pieces/ (without .stl), or "straight".
Piece = "straight";
// Length of a straight, in openGrid cells.
Length_Units = 5;

if (Piece == "straight")
    union() for (i = [0 : max(1, round(Length_Units)) - 1]) translate([0, i * 28, 0]) import("pieces/straight-1.stl");
else
    import(str("pieces/", Piece, ".stl"));
