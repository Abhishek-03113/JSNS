import os
import json
import re
import logging
import requests
import sys
import time
import json
from typing import List, Dict, Any, Optional
import bs4
from bs4 import BeautifulSoup, Tag, NavigableString, ResultSet
from scrapy import Selector, Request


def parseResume(fpath, wpath):
    """_summary_

    Args:
        fpath (str): input path for latex resume
        wpath (str): output path for parsed resume sections

    Returns:
        Resume sections parsed into separate latex files easy to ingest into a LLM
    """

    if not os.path.exists(fpath):
        logging.error(f"File {fpath} does not exist.")
        return

    with open(fpath, 'r', encoding='utf-8') as file:
        content = file.read()

    # Split the content into sections based on the \section command

    sections = re.split(r'\\section\{(.*?)\}', content)
    sections = [s.strip() for s in sections if s.strip()]

    if not os.path.exists(wpath):
        os.makedirs(wpath)
    for i in range(1, len(sections), 2):
        section_title = sections[i]
        section_content = sections[i + 1]

        # Create a filename based on the section title
        filename = re.sub(r'\W+', '_', section_title) + '.tex'
        filepath = os.path.join(wpath, filename)

        # Write the section content to a file
        with open(filepath, 'w', encoding='utf-8') as section_file:
            section_file.write(f"\\section{{{section_title}}}\n")
            section_file.write(section_content)
    logging.info(
        f"Parsed {len(sections) // 2} sections from {fpath} into {wpath}")
    return sections[1::2]  # Return only the section contents, excluding titles


def MultiResumeParser(input_dir: str, output_dir: str) -> List[str]:
    """Parse multiple resumes in a directory.

    Args:
        input_dir (str): Directory containing LaTeX resume files.
        output_dir (str): Directory to save parsed resume sections.

    Returns:
        List[str]: List of parsed section contents.
    """
    if not os.path.exists(input_dir):
        logging.error(f"Input directory {input_dir} does not exist.")
        return []

    if not os.path.exists(output_dir):
        os.makedirs(output_dir)

    all_sections = []
    for filename in os.listdir(input_dir):
        if filename.endswith('.tex'):
            fpath = os.path.join(input_dir, filename)
            sections = parseResume(fpath, output_dir)
            all_sections.extend(sections)

    return all_sections


def fetchJD(url, file_path=None, text=None):
    """Fetch a job description from a URL or use provided text. 
    If a file path is provided, it will save the job description to that file.
    Args:
        url (str): URL to fetch the job description from.
        file_path (str, optional): Path to save the job description. Defaults to None.
        text (str, optional): Job description text to use instead of fetching. Defaults to None.
        """
    # scraping stuff gonna do it later

    if text:
        jd_text = text
    elif file_path and os.path.exists(file_path):
        with open(file_path, 'r', encoding='utf-8') as file:
            jd_text = file.read()

    elif url:
        try:
            response = requests.get(url)
            response.raise_for_status()  # Raise an error for bad responses
            soup = BeautifulSoup(response.text, 'html.parser')

            # Extract job description text from the page
            jd_text = soup.get_text(separator='\n', strip=True)

            return jd_text

        except requests.RequestException as e:
            logging.error(f"Error fetching job description from {url}: {e}")
            return None
    else:
        logging.error("No job description provided or could not be fetched.")
        return None
