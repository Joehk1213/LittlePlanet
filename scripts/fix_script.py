with open(r'c:\Users\Joehk\OneDrive\Couse\Project\小行星網店\LittlePlanet\public\index.html', 'r', encoding='utf-8') as f:
    content = f.read()

# Clean up duplicate content in the script section
import re

# Remove duplicate "loadMemberWishlist();" followed by "Quick View Functions" and duplicated function definitions
# Replace the problematic section
content = content.replace("""loadMemberWishlist();
   // Quick View Functions
    function openQuickView(productData) {
 loadMemberWishlist();
    // Quick View Functions
   function openQuickView(productData) {""",
"""loadMemberWishlist();
   // Quick View Functions
   function openQuickView(productData) {""")

# Remove any additional duplicate function definitions before the closeModalBtn section
# Find the "closeModalBtn" line and remove any duplicated openQuickView function before it
match = content.find("closeModalBtn = document.getElementById('quickViewCloseBtn');")
if match != -1:
    # Get the content before closeModalBtn
    before = content[:match]
    # Find the last "function openQuickView(productData) {" occurrence
    last_func_start = before.rfind("function openQuickView(productData) {")
    if last_func_start != -1:
        # Find the corresponding closing brace of the function
        # Count braces to find the end
        brace_count = 0
        found_open = False
        func_end = last_func_start
        for i in range(last_func_start, len(before)):
            if before[i] == '{':
                brace_count += 1
                found_open = True
            elif before[i] == '}':
                brace_count -= 1
            if found_open and brace_count == 0:
                func_end = i + 1
                break
        if func_end < match:
            # Keep everything from the last function start
            content = before[:last_func_start] + "\n   // Quick View Functions\n   function openQuickView(productData) {\n" + before[last_func_start:func_end] + "\n" + content[match:]

with open(r'c:\Users\Joehk\OneDrive\Couse\Project\小行星網店\LittlePlanet\public\index.html', 'w', encoding='utf-8') as f:
    f.write(content)

print('Cleanup done')
EOF