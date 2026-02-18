# Gemini Agent with LangGraph

A powerful resume optimization agent built with Google's Gemini LLM and LangGraph for intelligent tool use and state management.

## Features

- **LangGraph Integration**: State-based agent workflow with conditional routing
- **Tool-Enabled**: 4 custom tools for resume analysis and optimization
- **Gemini 1.5 Pro**: Latest Google AI model with advanced reasoning
- **Streaming Support**: Real-time response streaming
- **Resume Optimization**: Specialized tools for ATS optimization

## Tools Available

1. **parse_resume_section**: Extract and analyze resume sections
2. **analyze_job_description**: Parse job requirements and skills
3. **calculate_match_score**: Match resume skills to job requirements
4. **suggest_improvements**: Provide actionable resume feedback

## Installation

1. Install dependencies:
```bash
pip install -r requirements.txt
```

2. Set up your environment variables:
```bash
# Create a .env file
echo "GEMINI_API_KEY=your_api_key_here" > .env
```

3. Get your Gemini API key from [Google AI Studio](https://makersuite.google.com/app/apikey)

## Usage

### Basic Usage

```python
from Agent.gemini_agent import GeminiAgent

# Initialize the agent
agent = GeminiAgent(model_name="gemini-1.5-pro")

# Ask a question
response = agent.invoke("Analyze this job description...")
print(response)
```

### With Custom System Prompt

```python
from Agent.gemini_agent import GeminiAgent
from Agent.prompts import systemprompt

agent = GeminiAgent()

response = agent.invoke(
    "Help me improve my resume",
    system_prompt=systemprompt
)
```

### Streaming Responses

```python
for chunk in agent.stream("What makes a great resume?"):
    if hasattr(chunk, 'content'):
        print(chunk.content, end='', flush=True)
```

### Using Tools Directly

The agent automatically decides when to use tools based on the conversation:

```python
# The agent will automatically use analyze_job_description tool
response = agent.invoke("""
    Analyze this job posting:
    Looking for Python developer with 5 years experience in AWS, Docker, and React.
""")

# The agent will use calculate_match_score tool
response = agent.invoke("""
    Calculate match between resume skills: Python, JavaScript, React
    and job requirements: Python, React, AWS, Docker
""")

# The agent will use suggest_improvements tool
response = agent.invoke("""
    Suggest improvements for this experience section:
    'Responsible for developing applications and helping with testing'
""")
```

## Architecture

The agent uses LangGraph to create a stateful workflow:

```
┌─────────┐
│  Start  │
└────┬────┘
     │
     ▼
┌─────────┐      Tool calls?     ┌───────┐
│  Agent  │─────────Yes─────────▶│ Tools │
└────┬────┘                      └───┬───┘
     │                               │
     │◀──────────────────────────────┘
     │
     │ No tool calls
     ▼
┌─────────┐
│   End   │
└─────────┘
```

### State Management

The agent maintains conversation state using `AgentState`:
- Messages history
- Tool call results
- Conversation context

### Tool Binding

Tools are bound to the Gemini LLM, allowing it to:
1. Decide which tool to use
2. Extract parameters from natural language
3. Use multiple tools in sequence
4. Provide structured outputs

## Running Examples

```bash
cd Agent
python example_usage.py
```

This will demonstrate:
- Job description analysis
- Resume improvement suggestions
- Match score calculations
- Streaming responses
- Custom prompt usage

## Advanced Configuration

### Custom Model

```python
agent = GeminiAgent(model_name="gemini-1.5-flash")
```

### Temperature Control

```python
agent.llm = ChatGoogleGenerativeAI(
    model="gemini-1.5-pro",
    temperature=0.3  # Lower for more focused responses
)
```

### Adding Custom Tools

```python
from langchain_core.tools import tool

@tool
def my_custom_tool(param: str) -> str:
    """Tool description."""
    return "result"

# Add to agent
agent.tools.append(my_custom_tool)
agent.llm_with_tools = agent.llm.bind_tools(agent.tools)
```

## Project Structure

```
ATS-buddy-main/
├── Agent/
│   ├── gemini_agent.py      # Main agent implementation
│   ├── prompts.py            # System prompts
│   ├── example_usage.py     # Usage examples
│   └── __pycache__/
├── Resume/                   # Resume LaTeX files
├── Parsed_Resume/           # Parsed resume sections
├── parser.py                # Resume parser utility
├── requirements.txt         # Python dependencies
└── .env                     # Environment variables
```

## API Reference

### GeminiAgent

**`__init__(model_name: str = "gemini-1.5-pro")`**
- Initialize the agent with specified Gemini model

**`invoke(message: str, system_prompt: str = None) -> str`**
- Send a message and get a complete response

**`stream(message: str, system_prompt: str = None)`**
- Stream the response in real-time

**`get_tools_info() -> List[Dict]`**
- Get metadata about available tools

## License

MIT

## Contributing

Feel free to add more tools or enhance existing functionality!
