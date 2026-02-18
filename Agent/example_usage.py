"""
Example usage of the Gemini Agent with LangGraph and tools.
"""

from gemini_agent import GeminiAgent
from prompts import systemprompt


def main():
    # Initialize the agent
    print("Initializing Gemini Agent...")
    agent = GeminiAgent(model_name="gemini-1.5-pro")

    # Print available tools
    print("\n=== Available Tools ===")
    tools = agent.get_tools_info()
    for tool in tools:
        print(f"\nTool: {tool['name']}")
        print(f"Description: {tool['description']}")

    print("\n" + "=" * 50)

    # Example 1: Analyze a job description
    print("\n=== Example 1: Analyzing Job Description ===")
    job_desc = """
    We are looking for a Senior Software Engineer with 5+ years of experience.
    Must have strong skills in Python, React, AWS, and Docker.
    Experience with Kubernetes and CI/CD pipelines is a plus.
    Bachelor's degree in Computer Science required.
    """

    response1 = agent.invoke(
        f"Please analyze this job description and tell me what skills are required: {job_desc}",
        system_prompt="You are a helpful assistant that analyzes job descriptions.",
    )
    print(f"\nAgent Response:\n{response1}")

    # Example 2: Suggest improvements for a resume section
    print("\n" + "=" * 50)
    print("\n=== Example 2: Suggesting Resume Improvements ===")
    experience_section = """
    Software Developer at ABC Company
    - Responsible for developing applications
    - Helped with database optimization
    - Assisted in code reviews
    """

    response2 = agent.invoke(
        f"Please analyze this experience section and suggest improvements: {experience_section}",
        system_prompt="You are an expert resume writer. Use your tools to provide specific feedback.",
    )
    print(f"\nAgent Response:\n{response2}")

    # Example 3: Calculate match score
    print("\n" + "=" * 50)
    print("\n=== Example 3: Calculating Resume-Job Match Score ===")

    response3 = agent.invoke(
        "Calculate the match score between these resume skills: 'Python, JavaScript, React, SQL, Git' "
        "and job requirements: 'Python, React, AWS, Docker, Kubernetes'",
        system_prompt="You are a career advisor helping match candidates to jobs.",
    )
    print(f"\nAgent Response:\n{response3}")

    # Example 4: Using the system prompt from prompts.py
    print("\n" + "=" * 50)
    print("\n=== Example 4: Using Custom System Prompt ===")

    response4 = agent.invoke(
        "Help me improve this summary section: 'Experienced developer looking for new opportunities. "
        "Good with Python and web development.'",
        system_prompt=systemprompt,
    )
    print(f"\nAgent Response:\n{response4}")

    # Example 5: Streaming response
    print("\n" + "=" * 50)
    print("\n=== Example 5: Streaming Response ===")
    print("\nAgent Response (streaming):")

    for chunk in agent.stream(
        "What are the key elements of a strong resume?",
        system_prompt="You are a resume expert.",
    ):
        if hasattr(chunk, "content"):
            print(chunk.content, end="", flush=True)

    print("\n\n" + "=" * 50)
    print("\nExamples completed!")


if __name__ == "__main__":
    main()
