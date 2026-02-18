import os
import json
import re
from typing import TypedDict, Annotated, Sequence
from dotenv import load_dotenv

from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.messages import BaseMessage, HumanMessage, AIMessage, ToolMessage
from langchain_core.tools import tool
from langgraph.graph import StateGraph, END
from langgraph.prebuilt import ToolNode
from langgraph.graph.message import add_messages

load_dotenv()

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")


# Define tools for the agent
@tool
def parse_resume_section(section_name: str, content: str) -> str:
    """
    Parse and extract key information from a resume section.

    Args:
        section_name: The name of the resume section (e.g., 'Experience', 'Education', 'Skills')
        content: The content of the section to parse

    Returns:
        A structured summary of the section
    """
    # Extract relevant information based on section type
    if "experience" in section_name.lower():
        # Extract job titles, companies, dates, and achievements
        result = {
            "section": section_name,
            "type": "experience",
            "content_length": len(content),
            "has_metrics": bool(
                re.search(
                    r"\d+%|\$\d+|increased|decreased|improved", content, re.IGNORECASE
                )
            ),
            "action_verbs": len(
                re.findall(
                    r"\b(led|managed|developed|created|implemented|optimized|architected|spearheaded|accelerated)\b",
                    content,
                    re.IGNORECASE,
                )
            ),
        }
    elif "education" in section_name.lower():
        result = {
            "section": section_name,
            "type": "education",
            "content_length": len(content),
        }
    elif "skill" in section_name.lower():
        result = {
            "section": section_name,
            "type": "skills",
            "content_length": len(content),
        }
    else:
        result = {
            "section": section_name,
            "type": "general",
            "content_length": len(content),
        }

    return json.dumps(result, indent=2)


@tool
def analyze_job_description(job_description: str) -> str:
    """
    Analyze a job description to extract key requirements and skills.

    Args:
        job_description: The job description text to analyze

    Returns:
        A structured analysis of the job requirements
    """
    # Extract key requirements
    skills_pattern = r"\b(Python|Java|JavaScript|React|Node\.js|AWS|Azure|Docker|Kubernetes|SQL|NoSQL|Machine Learning|AI|Data Science|CI/CD|Git|Agile|Scrum)\b"
    skills = list(set(re.findall(skills_pattern, job_description, re.IGNORECASE)))

    # Look for years of experience
    years_match = re.search(r"(\d+)\+?\s*years?", job_description, re.IGNORECASE)
    years_required = years_match.group(1) if years_match else "Not specified"

    # Look for education requirements
    education_match = re.search(
        r"(Bachelor's|Master's|PhD|Bachelor|Master|Doctorate)",
        job_description,
        re.IGNORECASE,
    )
    education_required = (
        education_match.group(1) if education_match else "Not specified"
    )

    result = {
        "skills_required": skills,
        "years_of_experience": years_required,
        "education_level": education_required,
        "description_length": len(job_description),
        "total_requirements": len(skills),
    }

    return json.dumps(result, indent=2)


@tool
def calculate_match_score(resume_skills: str, job_requirements: str) -> str:
    """
    Calculate how well a resume matches job requirements.

    Args:
        resume_skills: Comma-separated list of skills from resume
        job_requirements: Comma-separated list of required skills from job

    Returns:
        Match score and analysis
    """
    resume_skills_list = [s.strip().lower() for s in resume_skills.split(",")]
    job_requirements_list = [s.strip().lower() for s in job_requirements.split(",")]

    matched_skills = set(resume_skills_list) & set(job_requirements_list)
    missing_skills = set(job_requirements_list) - set(resume_skills_list)

    if len(job_requirements_list) > 0:
        match_percentage = (len(matched_skills) / len(job_requirements_list)) * 100
    else:
        match_percentage = 0

    result = {
        "match_percentage": round(match_percentage, 2),
        "matched_skills": list(matched_skills),
        "missing_skills": list(missing_skills),
        "total_resume_skills": len(resume_skills_list),
        "total_job_requirements": len(job_requirements_list),
    }

    return json.dumps(result, indent=2)


@tool
def suggest_improvements(section_content: str, section_type: str) -> str:
    """
    Suggest improvements for a resume section based on best practices.

    Args:
        section_content: The content of the resume section
        section_type: The type of section (e.g., 'experience', 'summary', 'skills')

    Returns:
        Specific improvement suggestions
    """
    suggestions = []

    if section_type.lower() == "experience":
        # Check for action verbs
        if not re.search(
            r"\b(led|managed|developed|created|implemented|optimized|architected|spearheaded|accelerated)\b",
            section_content,
            re.IGNORECASE,
        ):
            suggestions.append(
                "Add strong action verbs at the beginning of bullet points"
            )

        # Check for metrics
        if not re.search(
            r"\d+%|\$\d+|increased|decreased|improved", section_content, re.IGNORECASE
        ):
            suggestions.append(
                "Include quantifiable metrics and results (e.g., percentages, dollar amounts, time savings)"
            )

        # Check for passive language
        if re.search(
            r"\b(responsible for|helped with|assisted in)\b",
            section_content,
            re.IGNORECASE,
        ):
            suggestions.append(
                "Replace passive phrases like 'responsible for' with active achievement statements"
            )

    elif section_type.lower() == "summary":
        if len(section_content) < 100:
            suggestions.append(
                "Expand the summary to 3-4 impactful sentences highlighting your unique value proposition"
            )

        if len(section_content) > 500:
            suggestions.append("Condense the summary to be more concise and impactful")

    elif section_type.lower() == "skills":
        if len(section_content.split(",")) < 5:
            suggestions.append(
                "Add more relevant technical skills to demonstrate breadth of expertise"
            )

    if not suggestions:
        suggestions.append(
            "This section looks strong! Consider minor wording refinements for maximum impact."
        )

    result = {
        "section_type": section_type,
        "suggestions": suggestions,
        "content_length": len(section_content),
    }

    return json.dumps(result, indent=2)


# Define the agent state
class AgentState(TypedDict):
    messages: Annotated[Sequence[BaseMessage], add_messages]


class GeminiAgent:
    def __init__(self, model_name: str = "gemini-1.5-pro"):
        """
        Initialize the Gemini agent with LangGraph.

        Args:
            model_name: The Gemini model to use
        """
        self.model_name = model_name
        self.llm = ChatGoogleGenerativeAI(
            model=model_name, google_api_key=GEMINI_API_KEY, temperature=0.7
        )

        # Define available tools
        self.tools = [
            parse_resume_section,
            analyze_job_description,
            calculate_match_score,
            suggest_improvements,
        ]

        # Bind tools to the LLM
        self.llm_with_tools = self.llm.bind_tools(self.tools)

        # Create the graph
        self.graph = self._create_graph()

    def _create_graph(self):
        """Create the LangGraph state graph."""
        # Define the workflow graph
        workflow = StateGraph(AgentState)

        # Add nodes
        workflow.add_node("agent", self._agent_node)
        workflow.add_node("tools", ToolNode(self.tools))

        # Set entry point
        workflow.set_entry_point("agent")

        # Add conditional edges
        workflow.add_conditional_edges(
            "agent", self._should_continue, {"continue": "tools", "end": END}
        )

        # Add edge from tools back to agent
        workflow.add_edge("tools", "agent")

        # Compile the graph
        return workflow.compile()

    def _agent_node(self, state: AgentState):
        """The agent node that calls the LLM."""
        messages = state["messages"]
        response = self.llm_with_tools.invoke(messages)
        return {"messages": [response]}

    def _should_continue(self, state: AgentState):
        """Determine whether to continue or end the workflow."""
        messages = state["messages"]
        last_message = messages[-1]

        # If there are tool calls, continue to tools node
        if hasattr(last_message, "tool_calls") and last_message.tool_calls:
            return "continue"

        # Otherwise, end the workflow
        return "end"

    def invoke(self, message: str, system_prompt: str = None):
        """
        Invoke the agent with a message.

        Args:
            message: The user message
            system_prompt: Optional system prompt to guide the agent

        Returns:
            The agent's response
        """
        messages = []

        if system_prompt:
            messages.append(HumanMessage(content=f"System: {system_prompt}"))

        messages.append(HumanMessage(content=message))

        # Invoke the graph
        result = self.graph.invoke({"messages": messages})

        return result["messages"][-1].content

    def stream(self, message: str, system_prompt: str = None):
        """
        Stream the agent's response.

        Args:
            message: The user message
            system_prompt: Optional system prompt to guide the agent

        Yields:
            Chunks of the agent's response
        """
        messages = []

        if system_prompt:
            messages.append(HumanMessage(content=f"System: {system_prompt}"))

        messages.append(HumanMessage(content=message))

        # Stream the graph execution
        for event in self.graph.stream({"messages": messages}):
            for value in event.values():
                if "messages" in value:
                    yield value["messages"][-1]

    def get_tools_info(self):
        """Get information about available tools."""
        tools_info = []
        for tool in self.tools:
            tools_info.append(
                {"name": tool.name, "description": tool.description, "args": tool.args}
            )
        return tools_info
