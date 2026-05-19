import { describe, expect, it } from 'vitest';
import { SkillRegistry } from '../../src/skills/_registry.js';
import { slackPostMessageSkill } from '../../src/skills/slack/post-message.js';

describe('SkillRegistry', () => {
  it('registers and retrieves skills', () => {
    const registry = new SkillRegistry();
    registry.register(slackPostMessageSkill);
    expect(registry.get('slack.post-message').id).toBe('slack.post-message');
    expect(registry.list()).toHaveLength(1);
  });

  it('throws on duplicate registration', () => {
    const registry = new SkillRegistry();
    registry.register(slackPostMessageSkill);
    expect(() => registry.register(slackPostMessageSkill)).toThrow(/already registered/);
  });
});
