import re

path = r'c:\Users\user\Downloads\stitch_studentconnect_prd\js\app.js'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# Target the final appendChild in renderMessage
# We look for the one after the wrapper.appendChild calls
pattern = re.compile(r'(if \(isMine\) \{.*?wrapper\.appendChild\(msgDiv\);.*?wrapper\.appendChild\(avatar\);.*?\} else \{.*?wrapper\.appendChild\(avatar\);.*?wrapper\.appendChild\(msgDiv\);.*?\}\s+)(// APPEND for normal DOM order.*?messagesContainer\.appendChild\(wrapper\);)', re.DOTALL)

replacement = r'\1// PREPEND for inverted layout (DOM index 0 is visually at the bottom)\n      if (container) {\n        container.appendChild(wrapper); // Batch loading builds from bottom to top\n      } else {\n        messagesContainer.prepend(wrapper); // Real-time prepends to stay at bottom\n      }'

new_content = pattern.sub(replacement, content)

with open(path, 'w', encoding='utf-8') as f:
    f.write(new_content)

print("Replacement complete.")
