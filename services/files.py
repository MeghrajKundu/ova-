import os
from pathlib import Path
from pypdf import PdfReader

# Where uploaded files are stored
UPLOAD_FOLDER = "uploads"

# Maximum file size: 10 MB
MAX_FILE_SIZE = 10 * 1024 * 1024

# File types OVA is allowed to read
ALLOWED_EXTENSIONS = {
    ".pdf",
    ".txt",
    ".csv",
    ".json",
    ".py",
    ".js",
    ".jsx",
    ".ts",
    ".tsx",
    ".html",
    ".css",
    ".md",
    ".cpp",
    ".c",
    ".java",
    ".sql",
    ".sh",
    ".yml",
    ".yaml",
    ".xml"
}


def allowed_file(filename):
    """
    Check whether the file extension is supported.
    """

    extension = Path(filename).suffix.lower()

    return extension in ALLOWED_EXTENSIONS


def save_uploaded_file(file):
    """
    Safely save an uploaded file.
    """

    if not file or not file.filename:
        raise ValueError("No file selected.")

    filename = Path(file.filename).name

    if not allowed_file(filename):
        raise ValueError(
            "Unsupported file type."
        )

    # Read file into memory so we can check its size
    data = file.read()

    if len(data) > MAX_FILE_SIZE:
        raise ValueError(
            "File is too large. Maximum size is 10 MB."
        )

    os.makedirs(
        UPLOAD_FOLDER,
        exist_ok=True
    )

    # Prevent unsafe filenames
    safe_name = (
        filename
        .replace("/", "_")
        .replace("\\", "_")
        .replace("..", "_")
    )

    path = os.path.join(
        UPLOAD_FOLDER,
        safe_name
    )

    # Avoid overwriting an existing file
    base = Path(safe_name).stem
    extension = Path(safe_name).suffix

    counter = 1

    while os.path.exists(path):

        safe_name = (
            f"{base}_{counter}{extension}"
        )

        path = os.path.join(
            UPLOAD_FOLDER,
            safe_name
        )

        counter += 1

    with open(path, "wb") as output:
        output.write(data)

    return path


def read_text_file(path):
    """
    Read a normal text-based file.
    """

    with open(
        path,
        "r",
        encoding="utf-8",
        errors="replace"
    ) as file:

        return file.read()


def read_pdf(path):
    """
    Extract text from a PDF.
    """

    reader = PdfReader(path)

    pages = []

    for page in reader.pages:

        text = page.extract_text()

        if text:
            pages.append(text)

    return "\n\n".join(pages)


def read_file(path):
    """
    Automatically choose the correct reader.
    """

    extension = Path(path).suffix.lower()

    if extension == ".pdf":
        return read_pdf(path)

    return read_text_file(path)


def limit_text(text, max_characters=50000):
    """
    Prevent enormous files from being sent
    directly to the AI model.
    """

    if len(text) <= max_characters:
        return text

    return (
        text[:max_characters]
        + "\n\n[File truncated because it is too large.]"
    )