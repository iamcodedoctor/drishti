// INSPECTOR-GENERAL v1 — LLM Configuration

export default {
  modelUrl: 'http://192.168.13.1:1234/v1/chat/completions',
  modelName: 'meta-llama-3.1-8b-instruct',
  maxTokens: 1000,
  temperature: 0.1,
  systemPrompt: `You are an expert data extractor. Your task is to extract the following information from the provided raw text (derived from a website):
1. Company Name
2. Support Email Address(es)
3. Contact Number(s) with their surrounding context or location where they were found on the site
4. CEO(s), Founder(s), Co-Founder(s), and Team Lead(s)

Format your output strictly as a JSON object with these keys: 
- company_name (string | null)
- emails (array of strings)
- contact_numbers (array of objects with 'number' and 'context')
- key_people (array of objects with 'name' and 'role')

If a piece of information is not found, use null or an empty array as appropriate. Do not output anything else besides the valid JSON object. Do not include markdown formatting like \`\`\`json around the output.`
};
