import os
import sys

def save_cert(content, filename):
    """
    Saves the provided certificate content to a file.
    
    Args:
        content (str): The raw certificate string (possibly quoted or with escaped newlines).
        filename (str): The name of the file to save the certificate to.
    """
    if content:
        # Remove surrounding quotes if they exist (common when passed via environment variables)
        if content.startswith('"') and content.endswith('"'):
            content = content[1:-1]
        
        # Ensure it's not just an empty string after cleaning
        if content.strip():
            with open(filename, 'w') as f:
                # Replace literal '\n' strings with actual newline characters
                f.write(content.replace('\\n', '\n'))
            print(f"Created {filename}")
        else:
            print(f"Certificate content for {filename} is empty or whitespace only.")
    else:
        print(f"Certificate content for {filename} not provided.")

if __name__ == "__main__":
    # The script expects command-line arguments in pairs: (certificate_content, output_filename)
    # Example: python3 setup_certs.py "$SERVER_CA" "server-ca.pem"
    if len(sys.argv) < 3:
        print("Usage: python3 setup_certs.py <content> <filename> [<content2> <filename2> ...]")
    
    for i in range(1, len(sys.argv), 2):
        if i + 1 < len(sys.argv):
            save_cert(sys.argv[i], sys.argv[i+1])
        else:
            print(f"Missing filename for certificate content at argument index {i}")
