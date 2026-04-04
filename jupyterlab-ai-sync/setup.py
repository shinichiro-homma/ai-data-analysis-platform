"""
JupyterLab AI Sync Extension
"""
from pathlib import Path
import json
import setuptools

HERE = Path(__file__).parent.resolve()

# Get the package info from package.json
with open(HERE / "package.json") as f:
    package_json = json.load(f)

labext_name = package_json["name"]

# Get the lab path
lab_path = HERE / package_json["jupyterlab"]["outputDir"]

# Representative files that should exist after a successful build
ensured_targets = [
    str(lab_path / "package.json"),
    str(lab_path / "static" / "style.js")
]

labext_name = package_json["name"]

data_files_spec = [
    ("share/jupyter/labextensions/%s" % labext_name, str(lab_path.relative_to(HERE)), "**"),
    ("share/jupyter/labextensions/%s" % labext_name, str(HERE), "install.json"),
]

try:
    from jupyter_packaging import (
        wrap_installers,
        npm_builder,
        get_data_files
    )
    post_develop = npm_builder(
        build_cmd="build:labextension", source_dir=".", build_dir=lab_path
    )
    cmdclass = wrap_installers(post_develop=post_develop, ensured_targets=ensured_targets)

    setup_args = dict(
        cmdclass=cmdclass,
        data_files=get_data_files(data_files_spec)
    )
except ImportError:
    setup_args = {}

setuptools.setup(
    name=labext_name,
    version=package_json["version"],
    description=package_json["description"],
    long_description=(HERE / "README.md").read_text() if (HERE / "README.md").exists() else "",
    long_description_content_type="text/markdown",
    url=package_json.get("homepage", ""),
    author=package_json.get("author", {}).get("name", ""),
    author_email=package_json.get("author", {}).get("email", ""),
    license=package_json.get("license", ""),
    platforms="Linux, Mac OS X, Windows",
    keywords=["Jupyter", "JupyterLab", "JupyterLab4"],
    classifiers=[
        "Framework :: Jupyter",
        "Framework :: Jupyter :: JupyterLab",
        "Framework :: Jupyter :: JupyterLab :: 4",
        "Framework :: Jupyter :: JupyterLab :: Extensions",
        "Framework :: Jupyter :: JupyterLab :: Extensions :: Prebuilt",
        "License :: OSI Approved :: MIT License",
        "Programming Language :: Python",
        "Programming Language :: Python :: 3",
        "Programming Language :: Python :: 3.8",
        "Programming Language :: Python :: 3.9",
        "Programming Language :: Python :: 3.10",
        "Programming Language :: Python :: 3.11",
    ],
    install_requires=[
        "jupyterlab>=4.0.0,<5",
    ],
    python_requires=">=3.8",
    packages=[],
    include_package_data=True,
    zip_safe=False,
    **setup_args
)
