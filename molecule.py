"""
molecule.py — Render 2D molecular structures from SMILES strings using RDKit.
"""

import io
import logging
from typing import Optional

logger = logging.getLogger(__name__)

try:
    from rdkit import Chem
    from rdkit.Chem import Draw, AllChem
    RDKIT_AVAILABLE = True
except ImportError:
    RDKIT_AVAILABLE = False
    logger.warning(
        "RDKit not installed. Molecular structure rendering from SMILES "
        "will be unavailable. Install with: pip install rdkit-pypi"
    )


def smiles_to_image(smiles: str, size: tuple = (400, 300)) -> Optional[bytes]:
    """
    Convert a SMILES string to a PNG image (returned as bytes).

    Parameters
    ----------
    smiles : str
        Canonical SMILES string of the molecule.
    size : tuple
        Width and height in pixels.

    Returns
    -------
    bytes or None
        PNG image data, or None if rendering failed.
    """
    if not RDKIT_AVAILABLE:
        return None
    if not smiles or not smiles.strip():
        return None

    try:
        mol = Chem.MolFromSmiles(smiles.strip())
        if mol is None:
            logger.warning(f"RDKit could not parse SMILES: {smiles}")
            return None

        # Generate 2D coordinates for a clean layout
        AllChem.Compute2DCoords(mol)

        # Render to PNG
        img = Draw.MolToImage(mol, size=size)
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return buf.getvalue()

    except Exception as e:
        logger.error(f"Failed to render molecule from SMILES '{smiles}': {e}")
        return None


def is_valid_smiles(smiles: str) -> bool:
    """Check whether a SMILES string is parseable by RDKit."""
    if not RDKIT_AVAILABLE or not smiles:
        return False
    try:
        mol = Chem.MolFromSmiles(smiles.strip())
        return mol is not None
    except Exception:
        return False
