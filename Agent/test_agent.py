"""
Simple test script to verify the Gemini Agent setup.
"""

import os
from dotenv import load_dotenv


def test_environment():
    """Test if environment variables are set."""
    load_dotenv()
    api_key = os.getenv("GEMINI_API_KEY")

    if not api_key:
        print("❌ GEMINI_API_KEY not found in .env file")
        print("Please create a .env file with your API key:")
        print('echo "GEMINI_API_KEY=your_key_here" > .env')
        return False

    print("✅ GEMINI_API_KEY found")
    return True


def test_imports():
    """Test if all required packages are installed."""
    try:
        import langchain

        print("✅ langchain installed")
    except ImportError:
        print("❌ langchain not installed")
        return False

    try:
        import langgraph

        print("✅ langgraph installed")
    except ImportError:
        print("❌ langgraph not installed")
        return False

    try:
        from langchain_google_genai import ChatGoogleGenerativeAI

        print("✅ langchain-google-genai installed")
    except ImportError:
        print("❌ langchain-google-genai not installed")
        return False

    return True


def test_agent_initialization():
    """Test if the agent can be initialized."""
    try:
        from gemini_agent import GeminiAgent

        agent = GeminiAgent(model_name="gemini-1.5-pro")
        print("✅ GeminiAgent initialized successfully")
        print(f"   Model: {agent.model_name}")
        print(f"   Tools: {len(agent.tools)}")
        return True
    except Exception as e:
        print(f"❌ Failed to initialize GeminiAgent: {e}")
        return False


def test_agent_invoke():
    """Test if the agent can process a simple query."""
    try:
        from gemini_agent import GeminiAgent

        agent = GeminiAgent()

        print("\n🔄 Testing agent with a simple query...")
        response = agent.invoke("Say 'Hello!' if you can hear me.")

        if response:
            print("✅ Agent responded successfully")
            print(f"   Response preview: {response[:100]}...")
            return True
        else:
            print("❌ Agent returned empty response")
            return False

    except Exception as e:
        print(f"❌ Failed to invoke agent: {e}")
        return False


def main():
    print("=" * 50)
    print("Gemini Agent Test Suite")
    print("=" * 50)

    print("\n1. Testing Environment...")
    if not test_environment():
        print("\n⚠️  Please set up your environment variables first")
        return

    print("\n2. Testing Imports...")
    if not test_imports():
        print("\n⚠️  Please install required packages:")
        print("pip install -r requirements.txt")
        return

    print("\n3. Testing Agent Initialization...")
    if not test_agent_initialization():
        print("\n⚠️  Agent initialization failed")
        return

    print("\n4. Testing Agent Invocation...")
    if not test_agent_invoke():
        print("\n⚠️  Agent invocation failed")
        return

    print("\n" + "=" * 50)
    print("✅ All tests passed! The agent is ready to use.")
    print("=" * 50)
    print("\nNext steps:")
    print("1. Run: python example_usage.py")
    print("2. Or import and use GeminiAgent in your own code")


if __name__ == "__main__":
    main()
